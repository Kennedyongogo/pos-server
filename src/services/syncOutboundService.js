const config = require('../config/config');
const { db } = require('../config/database');
const syncReceive = require('./syncReceiveService');

let lastSyncAt = null;
let lastSyncError = null;

function isShopMode() {
  return Boolean(config.sync.vpsApiUrl && config.sync.shopClientCode);
}

function isCentralMode() {
  return config.sync.mode === 'central' || (!config.sync.vpsApiUrl && config.sync.apiKey);
}

function syncHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Sync-Key': config.sync.apiKey
  };
}

function packageQueueItem(row) {
  if (row.table_name === 'transactions') {
    const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(row.record_id);
    if (!transaction) return null;
    const items = db
      .prepare('SELECT * FROM transaction_items WHERE transaction_id = ?')
      .all(row.record_id);
    return {
      queue_id: row.id,
      table_name: row.table_name,
      record_id: row.record_id,
      action: row.action,
      payload: { transaction, items }
    };
  }

  if (row.table_name === 'products') {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(row.record_id);
    if (!product) return null;
    return {
      queue_id: row.id,
      table_name: row.table_name,
      record_id: row.record_id,
      action: row.action,
      payload: product
    };
  }

  return null;
}

function getLocalClient() {
  if (!config.sync.shopClientCode) return null;
  return db
    .prepare('SELECT * FROM clients WHERE client_code = ?')
    .get(config.sync.shopClientCode);
}

function upsertBootstrapData(data) {
  const { client, products, users } = data;
  const run = db.transaction(() => {
    const existingClient = db.prepare('SELECT id FROM clients WHERE client_code = ?').get(client.client_code);
    if (existingClient && existingClient.id !== client.id) {
      db.prepare('UPDATE products SET client_id = ? WHERE client_id = ?').run(client.id, existingClient.id);
      db.prepare('UPDATE users SET client_id = ? WHERE client_id = ?').run(client.id, existingClient.id);
      db.prepare('UPDATE transactions SET client_id = ? WHERE client_id = ?').run(client.id, existingClient.id);
      db.prepare('UPDATE sync_queue SET client_id = ? WHERE client_id = ?').run(client.id, existingClient.id);
      db.prepare('DELETE FROM clients WHERE id = ?').run(existingClient.id);
    }

    const clientRow = db.prepare('SELECT id FROM clients WHERE id = ?').get(client.id);
    if (clientRow) {
      db.prepare(`
        UPDATE clients SET client_code=?, business_name=?, owner_name=?, phone=?, email=?, address=?, active=?
        WHERE id=?
      `).run(
        client.client_code,
        client.business_name,
        client.owner_name,
        client.phone,
        client.email,
        client.address,
        client.active ?? 1,
        client.id
      );
    } else {
      db.prepare(`
        INSERT INTO clients (id, client_code, business_name, owner_name, phone, email, address, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        client.id,
        client.client_code,
        client.business_name,
        client.owner_name,
        client.phone,
        client.email,
        client.address,
        client.active ?? 1
      );
    }

    for (const product of products) {
      syncReceive.applyProduct(client.id, product);
    }

    for (const user of users) {
      const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id);
      if (existingUser) {
        db.prepare(`
          UPDATE users SET client_id=?, username=?, password=?, full_name=?, role=?, active=?
          WHERE id=?
        `).run(
          client.id,
          user.username,
          user.password,
          user.full_name,
          user.role,
          user.active ?? 1,
          user.id
        );
      } else {
        db.prepare(`
          INSERT INTO users (id, client_id, username, password, full_name, role, active)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          user.id,
          client.id,
          user.username,
          user.password,
          user.full_name,
          user.role,
          user.active ?? 1
        );
      }
    }
  });

  run();
}

async function bootstrapFromVps() {
  if (!isShopMode()) {
    return { bootstrapped: false, reason: 'not_configured' };
  }

  const res = await fetch(`${config.sync.vpsApiUrl}/sync/bootstrap`, {
    method: 'POST',
    headers: syncHeaders(),
    body: JSON.stringify({ client_code: config.sync.shopClientCode })
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Bootstrap failed (HTTP ${res.status})`);
  }

  upsertBootstrapData(body.data);
  lastSyncAt = new Date().toISOString();
  lastSyncError = null;

  return { bootstrapped: true, products: body.data.products.length, users: body.data.users.length };
}

async function flushSyncQueue() {
  if (!isShopMode()) {
    return { synced: 0, pending: 0, configured: false };
  }

  let client = getLocalClient();
  if (!client) {
    await bootstrapFromVps();
    client = getLocalClient();
  }

  if (!client) {
    throw new Error('Shop client not found locally after bootstrap');
  }

  const queue = db
    .prepare('SELECT * FROM sync_queue WHERE client_id = ? ORDER BY id LIMIT 100')
    .all(client.id);

  if (!queue.length) {
    return { synced: 0, pending: 0, configured: true };
  }

  const items = queue.map(packageQueueItem).filter(Boolean);
  if (!items.length) {
    db.prepare(`DELETE FROM sync_queue WHERE client_id = ?`).run(client.id);
    return { synced: 0, pending: 0, configured: true };
  }

  const res = await fetch(`${config.sync.vpsApiUrl}/sync/push`, {
    method: 'POST',
    headers: syncHeaders(),
    body: JSON.stringify({
      client_code: config.sync.shopClientCode,
      items
    })
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    lastSyncError = body.error || `Push failed (HTTP ${res.status})`;
    throw new Error(lastSyncError);
  }

  const processedIds = (body.data?.results || [])
    .map((r) => r.queue_id)
    .filter(Boolean);

  const deleteStmt = db.prepare('DELETE FROM sync_queue WHERE id = ?');
  const markSyncedTx = db.prepare('UPDATE transactions SET synced = 1 WHERE id = ?');
  const markSyncedProduct = db.prepare('UPDATE products SET synced = 1 WHERE id = ?');

  for (const result of body.data.results || []) {
    if (result.queue_id) deleteStmt.run(result.queue_id);
    if (result.table_name === 'transactions' && result.record_id) {
      markSyncedTx.run(result.record_id);
    }
    if (result.table_name === 'products' && result.record_id) {
      markSyncedProduct.run(result.record_id);
    }
  }

  const remaining = db
    .prepare('SELECT COUNT(*) as count FROM sync_queue WHERE client_id = ?')
    .get(client.id).count;

  lastSyncAt = new Date().toISOString();
  lastSyncError = null;

  return {
    synced: processedIds.length,
    pending: remaining,
    configured: true
  };
}

async function pullProductsFromVps() {
  if (!isShopMode()) return { pulled: 0 };

  const res = await fetch(
    `${config.sync.vpsApiUrl}/sync/products?client_code=${encodeURIComponent(config.sync.shopClientCode)}`,
    { headers: syncHeaders() }
  );

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Product pull failed (HTTP ${res.status})`);
  }

  const client = getLocalClient();
  if (!client) return { pulled: 0 };

  for (const product of body.data || []) {
    syncReceive.applyProduct(client.id, product);
  }

  return { pulled: (body.data || []).length };
}

function getSyncStatus() {
  const client = getLocalClient();
  const pending = client
    ? db.prepare('SELECT COUNT(*) as count FROM sync_queue WHERE client_id = ?').get(client.id).count
    : 0;

  return {
    shopMode: isShopMode(),
    centralMode: isCentralMode(),
    vpsApiUrl: config.sync.vpsApiUrl || null,
    shopClientCode: config.sync.shopClientCode || null,
    pending,
    lastSyncAt,
    lastSyncError
  };
}

module.exports = {
  isShopMode,
  isCentralMode,
  bootstrapFromVps,
  flushSyncQueue,
  pullProductsFromVps,
  getSyncStatus
};
