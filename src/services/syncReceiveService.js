const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const mpesaSettingsService = require('./mpesaSettingsService');

function getClientByCode(clientCode) {
  return db.prepare('SELECT * FROM clients WHERE client_code = ? AND active = 1').get(clientCode);
}

function applyProduct(clientId, product) {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(product.id);
  if (existing) {
    db.prepare(`
      UPDATE products SET barcode=?, name=?, price=?, cost=?, stock=?, category=?, updated_at=datetime('now'), synced=1
      WHERE id=? AND client_id=?
    `).run(
      product.barcode,
      product.name,
      product.price,
      product.cost || 0,
      product.stock || 0,
      product.category,
      product.id,
      clientId
    );
    return { action: 'updated' };
  }

  db.prepare(`
    INSERT INTO products (id, client_id, barcode, name, price, cost, stock, category, synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    product.id,
    clientId,
    product.barcode,
    product.name,
    product.price,
    product.cost || 0,
    product.stock || 0,
    product.category
  );
  return { action: 'created' };
}

function applyTransaction(clientId, payload) {
  const transaction = payload.transaction;
  const items = payload.items || [];

  const exists = db.prepare('SELECT id FROM transactions WHERE id = ?').get(transaction.id);
  if (exists) {
    return { action: 'skipped' };
  }

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (id, client_id, total, tax, discount, payment_method, cashier_name, cashier_id, created_at, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      transaction.id,
      clientId,
      transaction.total,
      transaction.tax || 0,
      transaction.discount || 0,
      transaction.payment_method || 'cash',
      transaction.cashier_name,
      transaction.cashier_id,
      transaction.created_at || new Date().toISOString()
    );

    const insertItem = db.prepare(`
      INSERT INTO transaction_items (id, transaction_id, product_id, product_name, quantity, unit_price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(
        item.id || uuidv4(),
        transaction.id,
        item.product_id,
        item.product_name,
        item.quantity,
        item.unit_price,
        item.subtotal
      );
    }
  });

  run();
  return { action: 'created' };
}

function applyUser(clientId, user, action) {
  if (!user?.id || !['admin', 'cashier'].includes(user.role)) {
    return { action: 'ignored' };
  }

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id);

  if (action === 'deactivate' || user.active === 0) {
    if (existing) {
      db.prepare('UPDATE users SET active = 0 WHERE id = ? AND client_id = ?').run(user.id, clientId);
      return { action: 'deactivated' };
    }
    return { action: 'skipped' };
  }

  if (existing) {
    db.prepare(`
      UPDATE users SET username=?, password=?, full_name=?, role=?, active=?
      WHERE id=? AND client_id=?
    `).run(
      user.username,
      user.password,
      user.full_name,
      user.role,
      user.active ?? 1,
      user.id,
      clientId
    );
    return { action: 'updated' };
  }

  db.prepare(`
    INSERT INTO users (id, client_id, username, password, full_name, role, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    clientId,
    user.username,
    user.password,
    user.full_name,
    user.role,
    user.active ?? 1
  );
  return { action: 'created' };
}

function applySyncItem(clientId, item) {
  if (item.table_name === 'products') {
    return applyProduct(clientId, item.payload);
  }
  if (item.table_name === 'transactions') {
    return applyTransaction(clientId, item.payload);
  }
  if (item.table_name === 'users') {
    return applyUser(clientId, item.payload, item.action);
  }
  return { action: 'ignored' };
}

function getBootstrapData(clientCode) {
  const client = getClientByCode(clientCode);
  if (!client) {
    return null;
  }

  const products = db
    .prepare('SELECT * FROM products WHERE client_id = ? ORDER BY name')
    .all(client.id);

  const users = db.prepare(`
    SELECT id, username, password, full_name, role, active
    FROM users
    WHERE client_id = ? AND role IN ('admin', 'cashier') AND active = 1
    ORDER BY created_at
  `).all(client.id);

  const mpesa = mpesaSettingsService.getPublicSettings(client.id);

  return { client, products, users, mpesa };
}

function processPush(clientCode, items) {
  const client = getClientByCode(clientCode);
  if (!client) {
    throw new Error(`Unknown client code: ${clientCode}`);
  }

  const results = [];
  for (const item of items) {
    results.push({
      queue_id: item.queue_id,
      table_name: item.table_name,
      record_id: item.record_id,
      ...applySyncItem(client.id, item)
    });
  }

  return { client_id: client.id, results };
}

function getUsersForClient(clientCode) {
  const client = getClientByCode(clientCode);
  if (!client) return null;

  const users = db.prepare(`
    SELECT id, username, password, full_name, role, active
    FROM users
    WHERE client_id = ? AND role IN ('admin', 'cashier')
    ORDER BY created_at
  `).all(client.id);

  return users;
}

module.exports = {
  getClientByCode,
  getBootstrapData,
  getUsersForClient,
  processPush,
  applyProduct,
  applyTransaction,
  applyUser
};
