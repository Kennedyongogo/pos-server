const { db } = require('../config/database');
const config = require('../config/config');

function shouldQueueForSync() {
  return Boolean(config.sync.vpsApiUrl && config.sync.shopClientCode);
}

function queueUserSync(userId, action) {
  if (!shouldQueueForSync()) return;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || user.role === 'system_owner') return;

  const payload = {
    id: user.id,
    username: user.username,
    password: user.password,
    full_name: user.full_name,
    role: user.role,
    active: user.active
  };

  db.prepare(`
    INSERT INTO sync_queue (table_name, record_id, action, data, client_id)
    VALUES (?, ?, ?, ?, ?)
  `).run('users', user.id, action, JSON.stringify(payload), user.client_id);
}

module.exports = { queueUserSync };
