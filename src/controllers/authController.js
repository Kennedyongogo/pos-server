const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');

exports.login = (req, res) => {
  try {
    const { username, password, client_code } = req.body;

    if (username === 'carlyvne_admin' && (!client_code || client_code === '')) {
      const user = db.prepare(`
        SELECT u.*, c.business_name, c.client_code
        FROM users u
        JOIN clients c ON u.client_id = c.id
        WHERE u.username = ? AND u.password = ? AND u.role = 'system_owner' AND u.active = 1
      `).get(username, password);

      if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }

      return res.json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
          client_id: user.client_id,
          client_code: user.client_code,
          business_name: user.business_name
        }
      });
    }

    if (!client_code || client_code === '') {
      return res.status(400).json({ success: false, error: 'Client code is required' });
    }

    const client = db.prepare('SELECT * FROM clients WHERE client_code = ? AND active = 1').get(client_code);
    if (!client) {
      return res.status(401).json({ success: false, error: 'Invalid client code' });
    }

    const user = db.prepare(`
      SELECT u.*, c.business_name, c.client_code
      FROM users u
      JOIN clients c ON u.client_id = c.id
      WHERE u.client_id = ? AND u.username = ? AND u.password = ? AND u.active = 1
    `).get(client.id, username, password);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        client_id: user.client_id,
        client_code: client.client_code,
        business_name: client.business_name
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.createClient = (req, res) => {
  try {
    const {
      createdBy,
      business_name,
      owner_name,
      phone,
      email,
      address,
      admin_username,
      admin_password
    } = req.body;

    const creator = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'system_owner'").get(createdBy);
    if (!creator) {
      return res.status(403).json({ success: false, error: 'Only system owner can create clients' });
    }

    const codePrefix = business_name.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '');
    const codeNumber = Math.floor(Math.random() * 9000) + 1000;
    const clientCode = codePrefix + codeNumber;
    const clientId = uuidv4();

    db.prepare(`
      INSERT INTO clients (id, client_code, business_name, owner_name, phone, email, address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(clientId, clientCode, business_name, owner_name, phone, email, address);

    const actualUsername = admin_username || 'admin';
    const actualPassword = admin_password || 'admin123';

    db.prepare(`
      INSERT INTO users (id, client_id, username, password, full_name, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), clientId, actualUsername, actualPassword, owner_name, 'admin');

    res.status(201).json({
      success: true,
      data: {
        client_code: clientCode,
        business_name,
        admin_username: actualUsername,
        admin_password: actualPassword
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.listClients = (req, res) => {
  try {
    const { userId } = req.query;
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'system_owner'").get(userId);
    if (!user) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const clients = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM users WHERE client_id = c.id) as user_count,
        (SELECT COUNT(*) FROM transactions WHERE client_id = c.id) as transaction_count,
        (SELECT username FROM users WHERE client_id = c.id AND role = 'admin' LIMIT 1) as admin_username
      FROM clients c
      WHERE c.client_code != 'CARLYVNE'
      ORDER BY c.created_at DESC
    `).all();

    res.json({ success: true, data: clients });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getClientCredentials = (req, res) => {
  try {
    const admin = db.prepare(`
      SELECT username, password FROM users
      WHERE client_id = ? AND role = 'admin'
      LIMIT 1
    `).get(req.params.clientId);

    if (!admin) {
      return res.status(404).json({ success: false, error: 'No admin found' });
    }

    res.json({ success: true, data: { username: admin.username, password: admin.password } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.listUsers = (req, res) => {
  try {
    const { client_id } = req.query;
    if (!client_id) {
      return res.status(400).json({ success: false, error: 'Client ID required' });
    }

    const users = db.prepare(`
      SELECT id, username, full_name, role, active, created_at
      FROM users
      WHERE client_id = ? AND role IN ('admin', 'cashier')
      ORDER BY created_at DESC
    `).all(client_id);

    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.createUser = (req, res) => {
  try {
    const { username, password, full_name, role, client_id, createdBy } = req.body;
    const userRole = role || 'cashier';

    if (!['admin', 'cashier'].includes(userRole)) {
      return res.status(400).json({ success: false, error: 'Role must be admin or cashier' });
    }

    const creator = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(createdBy);
    if (!creator) {
      return res.status(403).json({ success: false, error: 'Only admin can create users' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE client_id = ? AND username = ?').get(client_id, username);
    if (existing) {
      return res.status(400).json({ success: false, error: 'Username already exists' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO users (id, client_id, username, password, full_name, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, client_id, username, password, full_name, userRole);

    const user = db.prepare('SELECT id, username, full_name, role, created_at FROM users WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.deactivateUser = (req, res) => {
  try {
    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (targetUser.role === 'system_owner') {
      return res.status(400).json({ success: false, error: 'Cannot deactivate system owner' });
    }

    const adminCount = db
      .prepare('SELECT COUNT(*) as count FROM users WHERE client_id = ? AND role = ? AND active = 1')
      .get(targetUser.client_id, 'admin');

    if (targetUser.role === 'admin' && adminCount.count <= 1) {
      return res.status(400).json({ success: false, error: 'Cannot deactivate the last admin' });
    }

    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'User deactivated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
