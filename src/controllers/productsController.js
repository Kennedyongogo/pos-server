const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');

exports.list = (req, res) => {
  try {
    const { client_id } = req.query;
    const products = db.prepare('SELECT * FROM products WHERE client_id = ? ORDER BY name').all(client_id);
    res.json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getByBarcode = (req, res) => {
  try {
    const { client_id } = req.query;
    const product = db
      .prepare('SELECT * FROM products WHERE barcode = ? AND client_id = ?')
      .get(req.params.barcode, client_id);

    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.create = (req, res) => {
  try {
    const { barcode, name, price, cost, stock, category, client_id } = req.body;
    const id = uuidv4();

    db.prepare(`
      INSERT INTO products (id, client_id, barcode, name, price, cost, stock, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, client_id, barcode, name, price, cost || 0, stock || 0, category);

    db.prepare(`
      INSERT INTO sync_queue (table_name, record_id, action, data, client_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('products', id, 'create', JSON.stringify({ id, barcode, name, price }), client_id);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.update = (req, res) => {
  try {
    const { barcode, name, price, cost, stock, category } = req.body;
    db.prepare(`
      UPDATE products SET barcode=?, name=?, price=?, cost=?, stock=?, category=?, updated_at=datetime('now')
      WHERE id=?
    `).run(barcode, name, price, cost || 0, stock || 0, category, req.params.id);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.remove = (req, res) => {
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
