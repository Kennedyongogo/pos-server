const { db } = require('../config/database');
const config = require('../config/config');
const { encrypt, decrypt, maskSecret } = require('../utils/secretCrypto');

const SANDBOX_SHORTCODE = '174379';
const SANDBOX_PASSKEY =
  'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';

function getRow(clientId) {
  return db.prepare('SELECT * FROM client_mpesa_settings WHERE client_id = ?').get(clientId);
}

function normalizeShortcode(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePasskey(value) {
  return String(value || '').replace(/\s/g, '');
}

function validatePasskeyShape(passkey) {
  if (!passkey) return 'Lipa Na M-Pesa passkey is required';
  if (!/^[a-fA-F0-9]+$/.test(passkey)) {
    return 'Passkey must be a hex string from Daraja → M-Pesa Express (Lipa Na M-Pesa Online). Do not use Security Credential.';
  }
  if (passkey.length !== 64) {
    return `Passkey length is ${passkey.length}; Daraja passkeys are usually 64 hex characters.`;
  }
  return null;
}

function auditStkCredentials(clientId) {
  const row = getRow(clientId);
  if (!row) {
    return { ok: false, message: 'No M-Pesa settings saved' };
  }

  const env = (row.env || 'sandbox').toLowerCase();
  const shortcode = normalizeShortcode(row.shortcode);
  const passkey = row.passkey_enc ? normalizePasskey(decrypt(row.passkey_enc)) : '';
  const shapeError = passkey ? validatePasskeyShape(passkey) : 'Passkey not saved';

  return {
    ok: !shapeError && Boolean(shortcode) && Boolean(passkey),
    env,
    shortcode,
    passkeyLength: passkey.length,
    passkeyPreview: passkey ? maskSecret(passkey) : '',
    sandboxShortcodeMatch: env === 'sandbox' ? shortcode === SANDBOX_SHORTCODE : null,
    sandboxPasskeyMatch: env === 'sandbox' ? passkey === SANDBOX_PASSKEY : null,
    issue: shapeError || (!shortcode ? 'Shortcode missing' : null)
  };
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

function hasServerCallback() {
  return Boolean((config.mpesa.callbackUrl || '').trim());
}

function describeConfigurationGap(clientId) {
  const row = getRow(clientId);
  if (!row) {
    return 'No M-Pesa settings saved for this shop. Open Admin → M-Pesa and save your Daraja credentials.';
  }

  const missing = [];
  if (!row.enabled) missing.push('enable M-Pesa in settings');
  if (!row.shortcode) missing.push('business shortcode');
  if (!row.consumer_key_enc) missing.push('consumer key');
  if (!row.consumer_secret_enc) missing.push('consumer secret');
  if (!row.passkey_enc) missing.push('Lipa Na M-Pesa passkey');

  if (missing.length) {
    return `M-Pesa setup is incomplete: ${missing.join(', ')}.`;
  }

  if (!hasServerCallback()) {
    return 'The hosted server is missing MPESA_CALLBACK_URL in its environment (required for STK push).';
  }

  return null;
}

function getPublicSettings(clientId) {
  const row = getRow(clientId);
  if (!row) {
    return {
      enabled: false,
      configured: false,
      env: 'sandbox',
      shortcode: null,
      serverCallbackConfigured: hasServerCallback()
    };
  }
  const credentialsComplete = isComplete(row);
  return {
    enabled: Boolean(row.enabled),
    configured: credentialsComplete && hasServerCallback(),
    env: row.env || 'sandbox',
    shortcode: row.shortcode || null,
    serverCallbackConfigured: hasServerCallback(),
    credentialsComplete
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

  const normalizedPasskey = normalizePasskey(passkey);
  const stkAudit = auditStkCredentials(clientId);

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
    hasPasskey: Boolean(passkey),
    passkeyLength: normalizedPasskey.length,
    stkAudit
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
    shortcode: normalizeShortcode(row.shortcode),
    passkey: normalizePasskey(decrypt(row.passkey_enc)),
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
  const shortcode = normalizeShortcode(input.shortcode);

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
    ? normalizePasskey(input.passkey)
    : existing?.passkey_enc
      ? normalizePasskey(decrypt(existing.passkey_enc))
      : '';

  if (enabled) {
    const gaps = [];
    if (!shortcode) gaps.push('business shortcode');
    if (!consumerKey) gaps.push('consumer key');
    if (!consumerSecret) gaps.push('consumer secret');
    if (!passkey) gaps.push('Lipa Na M-Pesa passkey');
    if (gaps.length) {
      const err = new Error(`When M-Pesa is enabled, these fields are required: ${gaps.join(', ')}.`);
      err.status = 400;
      throw err;
    }

    const shapeError = validatePasskeyShape(passkey);
    if (shapeError) {
      const err = new Error(shapeError);
      err.status = 400;
      throw err;
    }

    if (env === 'sandbox' && shortcode === SANDBOX_SHORTCODE && passkey !== SANDBOX_PASSKEY) {
      const err = new Error(
        'Sandbox shortcode 174379 must use the standard Daraja sandbox passkey. Click "Fill sandbox defaults" in M-Pesa setup, or copy the Lipa Na M-Pesa Online passkey from developer.safaricom.co.ke → your app → M-Pesa Express.'
      );
      err.status = 400;
      throw err;
    }
  }

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
  isComplete,
  describeConfigurationGap,
  hasServerCallback,
  auditStkCredentials,
  SANDBOX_SHORTCODE,
  SANDBOX_PASSKEY
};
