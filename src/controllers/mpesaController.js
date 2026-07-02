const { db } = require('../config/database');
const mpesaService = require('../services/mpesaService');
const mpesaSettingsService = require('../services/mpesaSettingsService');
const mpesaProxyService = require('../services/mpesaProxyService');
const syncOutbound = require('../services/syncOutboundService');
const config = require('../config/config');

function resolveClientId({ client_id, client_code }) {
  if (client_id) return client_id;
  if (client_code) {
    const client = db.prepare('SELECT id FROM clients WHERE client_code = ? AND active = 1').get(client_code);
    return client?.id || null;
  }
  return null;
}

function assertProxyKey(req) {
  if (!config.sync.apiKey) return;
  const key = req.headers['x-sync-key'];
  if (key !== config.sync.apiKey) {
    const err = new Error('Invalid sync key');
    err.status = 401;
    throw err;
  }
}

function isProxyRequest(req) {
  return Boolean(req.body?.client_code || req.query?.client_code);
}

function assertSystemOwner(userId) {
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'system_owner'").get(userId);
  if (!user) {
    const err = new Error('Only system owner can manage M-Pesa settings');
    err.status = 403;
    throw err;
  }
}

exports.getConfig = async (req, res) => {
  try {
    if (isProxyRequest(req)) assertProxyKey(req);

    if (syncOutbound.isShopMode() && mpesaProxyService.isProxyConfigured()) {
      try {
        const data = await mpesaProxyService.getConfig();
        return res.json({
          success: true,
          data: {
            ...data,
            requiresInternet: true
          }
        });
      } catch {
        const client = db
          .prepare('SELECT id FROM clients WHERE client_code = ?')
          .get(config.sync.shopClientCode);
        const local = client ? mpesaSettingsService.getPublicSettings(client.id) : { configured: false, enabled: false };
        return res.json({
          success: true,
          data: {
            configured: local.configured,
            enabled: local.enabled,
            env: local.env,
            shortcode: local.shortcode,
            requiresInternet: true,
            offline: true
          }
        });
      }
    }

    const clientId = resolveClientId(req.query);
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'client_id or client_code is required' });
    }

    const publicSettings = mpesaSettingsService.getPublicSettings(clientId);
    res.json({
      success: true,
      data: {
        configured: publicSettings.configured,
        enabled: publicSettings.enabled,
        env: publicSettings.env,
        shortcode: publicSettings.shortcode,
        requiresInternet: true
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getSettings = (req, res) => {
  try {
    assertSystemOwner(req.query.userId);
    const masked = mpesaSettingsService.getMaskedSettings(req.params.clientId);
    res.json({ success: true, data: masked });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

exports.saveSettings = (req, res) => {
  try {
    assertSystemOwner(req.body.updatedBy);
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.clientId);
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const data = mpesaSettingsService.saveSettings(req.params.clientId, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

exports.testAuth = async (req, res) => {
  try {
    if (isProxyRequest(req)) assertProxyKey(req);

    if (syncOutbound.isShopMode() && mpesaProxyService.isProxyConfigured()) {
      const data = await mpesaProxyService.testAuth();
      return res.json({ success: true, data });
    }

    const clientId = resolveClientId(req.body);
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'client_id or client_code is required' });
    }

    const mpesaConfig = mpesaService.getMpesaConfigForClient(clientId);
    if (!mpesaConfig) {
      return res.status(503).json({ success: false, error: 'M-Pesa not configured for this shop' });
    }

    const token = await mpesaService.getAccessToken(mpesaConfig);
    res.json({
      success: true,
      data: {
        env: mpesaConfig.env,
        shortcode: mpesaConfig.shortcode,
        tokenReceived: Boolean(token),
        message: 'Daraja OAuth OK — credentials are valid for this shop'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.stkPush = async (req, res) => {
  try {
    if (syncOutbound.isShopMode() && mpesaProxyService.isProxyConfigured()) {
      const { phone, amount, accountReference, transactionDesc } = req.body;
      if (!phone || amount == null) {
        return res.status(400).json({ success: false, error: 'phone and amount are required' });
      }
      const data = await mpesaProxyService.stkPush({
        phone,
        amount,
        accountReference,
        transactionDesc
      });
      return res.json({ success: true, data });
    }

    if (isProxyRequest(req)) assertProxyKey(req);

    const clientId = resolveClientId(req.body);
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'client_id or client_code is required' });
    }

    const publicSettings = mpesaSettingsService.getPublicSettings(clientId);
    if (!publicSettings.enabled || !publicSettings.configured) {
      return res.status(503).json({
        success: false,
        error: 'M-Pesa is not enabled for this shop. Configure it in Client Management on the hosted server.'
      });
    }

    const { phone, amount, accountReference, transactionDesc } = req.body;
    if (!phone || amount == null) {
      return res.status(400).json({ success: false, error: 'phone and amount are required' });
    }

    const data = await mpesaService.initiateStkPush({
      clientId,
      phone,
      amount,
      accountReference,
      transactionDesc
    });

    res.json({ success: true, data });
  } catch (error) {
    console.log('M-Pesa STK error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.callback = (req, res) => {
  console.log('M-Pesa callback:', JSON.stringify(req.body));
  mpesaService.handleStkCallback(req.body);
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
};

exports.getStatus = async (req, res) => {
  try {
    if (syncOutbound.isShopMode() && mpesaProxyService.isProxyConfigured()) {
      const data = await mpesaProxyService.getStatus(req.params.checkoutRequestId);
      return res.json({ success: true, data });
    }

    if (isProxyRequest(req)) assertProxyKey(req);

    const data = mpesaService.getPaymentStatus(req.params.checkoutRequestId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
