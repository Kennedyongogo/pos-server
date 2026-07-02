const { db } = require('../config/database');
const config = require('../config/config');
const { encrypt, decrypt, maskSecret } = require('../utils/secretCrypto');

function getRow(clientId) {
  return db.prepare('SELECT * FROM client_mpesa_settings WHERE client_id = ?').get(clientId);
}

function isComplete(row) {
  return Boolean(
    row &&
    row.enabled &&
    row.shortcode &&
    row.consumer_key_enc &&
    row.consumer_secret_enc &&
    row.passkey_enc
  );
}

function getPublicSettings(clientId) {
  const row = getRow(clientId);
  if (!row) {
    return { enabled: false, configured: false, env: 'sandbox', shortcode: null };
  }
  return {
    enabled: Boolean(row.enabled),
    configured: isComplete(row),
    env: row.env || 'sandbox',
    shortcode: row.shortcode || null
  };
}

function getMaskedSettings(clientId) {
  const row = getRow(clientId);
  if (!row) {
    return {
      enabled: false,
      env: 'sandbox',
      shortcode: '',
      consumerKey: '',
      consumerSecret: '',
      passkey: '',
      configured: false
    };
  }

  const consumerKey = row.consumer_key_enc ? decrypt(row.consumer_key_enc) : '';
  const consumerSecret = row.consumer_secret_enc ? decrypt(row.consumer_secret_enc) : '';
  const passkey = row.passkey_enc ? decrypt(row.passkey_enc) : '';

  return {
    enabled: Boolean(row.enabled),
    env: row.env || 'sandbox',
    shortcode: row.shortcode || '',
    consumerKey: maskSecret(consumerKey),
    consumerSecret: maskSecret(consumerSecret),
    passkey: maskSecret(passkey),
    configured: isComplete(row),
    hasConsumerKey: Boolean(consumerKey),
    hasConsumerSecret: Boolean(consumerSecret),
    hasPasskey: Boolean(passkey)
  };
}

function getDecryptedConfig(clientId) {
  const row = getRow(clientId);
  if (!isComplete(row)) return null;

  const callbackUrl = (config.mpesa.callbackUrl || '').trim();
  if (!callbackUrl) return null;

  return {
    clientId,
    consumerKey: decrypt(row.consumer_key_enc),
    consumerSecret: decrypt(row.consumer_secret_enc),
    shortcode: row.shortcode,
    passkey: decrypt(row.passkey_enc),
    callbackUrl,
    env: (row.env || 'sandbox').toLowerCase(),
    baseUrl:
      (row.env || 'sandbox').toLowerCase() === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke'
  };
}

function saveSettings(clientId, input) {
  const existing = getRow(clientId);
  const enabled = input.enabled ? 1 : 0;
  const env = (input.env || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
  const shortcode = String(input.shortcode || '').trim();

  const consumerKey = input.consumerKey?.trim()
    ? input.consumerKey.trim()
    : existing?.consumer_key_enc
      ? decrypt(existing.consumer_key_enc)
      : '';
  const consumerSecret = input.consumerSecret?.trim()
    ? input.consumerSecret.trim()
    : existing?.consumer_secret_enc
      ? decrypt(existing.consumer_secret_enc)
      : '';
  const passkey = input.passkey?.trim()
    ? input.passkey.trim()
    : existing?.passkey_enc
      ? decrypt(existing.passkey_enc)
      : '';

  if (existing) {
    db.prepare(`
      UPDATE client_mpesa_settings
      SET enabled=?, env=?, shortcode=?, consumer_key_enc=?, consumer_secret_enc=?, passkey_enc=?, updated_at=datetime('now')
      WHERE client_id=?
    `).run(
      enabled,
      env,
      shortcode,
      consumerKey ? encrypt(consumerKey) : '',
      consumerSecret ? encrypt(consumerSecret) : '',
      passkey ? encrypt(passkey) : '',
      clientId
    );
  } else {
    db.prepare(`
      INSERT INTO client_mpesa_settings (client_id, enabled, env, shortcode, consumer_key_enc, consumer_secret_enc, passkey_enc)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      clientId,
      enabled,
      env,
      shortcode,
      consumerKey ? encrypt(consumerKey) : '',
      consumerSecret ? encrypt(consumerSecret) : '',
      passkey ? encrypt(passkey) : ''
    );
  }

  return getMaskedSettings(clientId);
}

function applyBootstrapSettings(clientId, mpesa) {
  if (!mpesa) return;
  const existing = getRow(clientId);
  if (existing) {
    db.prepare(`
      UPDATE client_mpesa_settings
      SET enabled=?, env=?, shortcode=?, updated_at=datetime('now')
      WHERE client_id=?
    `).run(mpesa.enabled ? 1 : 0, mpesa.env || 'sandbox', mpesa.shortcode || '', clientId);
    return;
  }
  db.prepare(`
    INSERT INTO client_mpesa_settings (client_id, enabled, env, shortcode, consumer_key_enc, consumer_secret_enc, passkey_enc)
    VALUES (?, ?, ?, ?, '', '', '')
  `).run(clientId, mpesa.enabled ? 1 : 0, mpesa.env || 'sandbox', mpesa.shortcode || '');
}

module.exports = {
  getPublicSettings,
  getMaskedSettings,
  getDecryptedConfig,
  saveSettings,
  applyBootstrapSettings,
  isComplete
};
