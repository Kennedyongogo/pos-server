const config = require('../config/config');
const syncReceive = require('../services/syncReceiveService');
const syncOutbound = require('../services/syncOutboundService');

function validateSyncKey(req, res) {
  const key = req.headers['x-sync-key'];
  if (!config.sync.apiKey || key !== config.sync.apiKey) {
    res.status(401).json({ success: false, error: 'Invalid sync key' });
    return false;
  }
  return true;
}

exports.bootstrap = (req, res) => {
  try {
    if (!validateSyncKey(req, res)) return;

    const { client_code } = req.body;
    if (!client_code) {
      return res.status(400).json({ success: false, error: 'client_code is required' });
    }

    const data = syncReceive.getBootstrapData(client_code);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Client not found on central server' });
    }

    res.json({
      success: true,
      data: {
        client: data.client,
        products: data.products,
        users: data.users
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.push = (req, res) => {
  try {
    if (!validateSyncKey(req, res)) return;

    const { client_code, items } = req.body;
    if (!client_code || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, error: 'client_code and items are required' });
    }

    const result = syncReceive.processPush(client_code, items);
    res.json({
      success: true,
      data: {
        client_id: result.client_id,
        results: result.results.map((r) => ({
          queue_id: r.queue_id,
          table_name: r.table_name,
          record_id: r.record_id,
          action: r.action
        })),
        processed_count: result.results.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.products = (req, res) => {
  try {
    if (!validateSyncKey(req, res)) return;

    const { client_code } = req.query;
    const data = syncReceive.getBootstrapData(client_code);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    res.json({ success: true, data: data.products });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.status = (req, res) => {
  res.json({
    success: true,
    data: {
      ...syncOutbound.getSyncStatus(),
      centralHub: syncOutbound.isCentralMode() || !syncOutbound.isShopMode()
    }
  });
};

exports.flush = async (req, res) => {
  try {
    if (!syncOutbound.isShopMode()) {
      return res.json({
        success: true,
        data: { message: 'Sync not configured (central server or local-only mode)' }
      });
    }

    await syncOutbound.pullProductsFromVps().catch(() => {});
    const result = await syncOutbound.flushSyncQueue();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.bootstrapLocal = async (req, res) => {
  try {
    const result = await syncOutbound.bootstrapFromVps();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
