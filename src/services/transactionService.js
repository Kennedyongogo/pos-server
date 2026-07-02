const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');

function createTransaction(payload) {
  const {
    items,
    total,
    tax,
    discount,
    payment_method,
    cashier_name,
    cashier_id,
    client_id
  } = payload;

  const transactionId = uuidv4();

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (id, client_id, total, tax, discount, payment_method, cashier_name, cashier_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transactionId,
      client_id,
      total,
      tax || 0,
      discount || 0,
      payment_method || 'cash',
      cashier_name || 'Unknown',
      cashier_id
    );

    const insertItem = db.prepare(`
      INSERT INTO transaction_items (id, transaction_id, product_id, product_name, quantity, unit_price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStock = db.prepare(`
      UPDATE products SET stock = stock - ?, updated_at = datetime('now')
      WHERE id = ? AND client_id = ?
    `);

    for (const item of items) {
      insertItem.run(
        uuidv4(),
        transactionId,
        item.product_id,
        item.product_name,
        item.quantity,
        item.unit_price,
        item.subtotal
      );
      updateStock.run(item.quantity, item.product_id, client_id);
    }

    db.prepare(`
      INSERT INTO sync_queue (table_name, record_id, action, data, client_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'transactions',
      transactionId,
      'create',
      JSON.stringify({ id: transactionId, items, total }),
      client_id
    );
  });

  run();

  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
  const transactionItems = db
    .prepare('SELECT * FROM transaction_items WHERE transaction_id = ?')
    .all(transactionId);
  const client = db.prepare('SELECT business_name FROM clients WHERE id = ?').get(client_id);

  return {
    ...transaction,
    items: transactionItems,
    receipt_number: 'POS-' + Date.now(),
    business_name: client ? client.business_name : 'POS System'
  };
}

function getTransactionById(id) {
  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!transaction) return null;
  const items = db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(id);
  return { ...transaction, items };
}

function listTodayTransactions(clientId) {
  return db.prepare(`
    SELECT * FROM transactions
    WHERE client_id = ? AND date(created_at) = date('now')
    ORDER BY created_at DESC
  `).all(clientId);
}

function listAllTransactions(clientId) {
  return db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM transaction_items WHERE transaction_id = t.id) as item_count,
      (SELECT COALESCE(SUM(quantity), 0) FROM transaction_items WHERE transaction_id = t.id) as total_qty
    FROM transactions t
    WHERE t.client_id = ?
    ORDER BY t.created_at DESC
    LIMIT 100
  `).all(clientId);
}

function getDailySummary(clientId) {
  return db.prepare(`
    SELECT
      COUNT(*) as total_transactions,
      COALESCE(SUM(total), 0) as total_sales,
      COALESCE(SUM(tax), 0) as total_tax,
      COALESCE(AVG(total), 0) as avg_sale,
      MIN(total) as min_sale,
      MAX(total) as max_sale
    FROM transactions
    WHERE client_id = ? AND date(created_at) = date('now')
  `).get(clientId);
}

module.exports = {
  createTransaction,
  getTransactionById,
  listTodayTransactions,
  listAllTransactions,
  getDailySummary
};
