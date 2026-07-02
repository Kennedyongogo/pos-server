const mpesaService = require('../services/mpesaService');
const config = require('../config/config');

exports.getConfig = (req, res) => {
  res.json({
    success: true,
    data: {
      configured: mpesaService.isConfigured(),
      env: config.mpesa.env || 'sandbox'
    }
  });
};

exports.testAuth = async (req, res) => {
  try {
    const mpesaConfig = mpesaService.getMpesaConfig();
    if (!mpesaConfig) {
      return res.status(503).json({ success: false, error: 'M-Pesa not configured in server/.env' });
    }

    const token = await mpesaService.getAccessToken(mpesaConfig);
    res.json({
      success: true,
      data: {
        env: mpesaConfig.env,
        tokenReceived: Boolean(token),
        message: 'Daraja OAuth OK — credentials are valid'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.stkPush = async (req, res) => {
  try {
    if (!mpesaService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'M-Pesa is not configured. Add credentials to server/.env and restart.'
      });
    }

    const { phone, amount, accountReference, transactionDesc } = req.body;
    if (!phone || amount == null) {
      return res.status(400).json({ success: false, error: 'phone and amount are required' });
    }

    const data = await mpesaService.initiateStkPush({
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

exports.getStatus = (req, res) => {
  const data = mpesaService.getPaymentStatus(req.params.checkoutRequestId);
  res.json({ success: true, data });
};
