const config = require('../config/config');

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `VPS M-Pesa request failed (HTTP ${res.status})`);
  }
  return body;
}

function syncHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Sync-Key': config.sync.apiKey
  };
}

function isProxyConfigured() {
  return Boolean(config.sync.vpsApiUrl && config.sync.shopClientCode && config.sync.apiKey);
}

async function getConfig() {
  const url = `${config.sync.vpsApiUrl}/mpesa/config?client_code=${encodeURIComponent(config.sync.shopClientCode)}`;
  const res = await fetch(url, { headers: syncHeaders() });
  const body = await readJson(res);
  return body.data;
}

async function stkPush(payload) {
  const res = await fetch(`${config.sync.vpsApiUrl}/mpesa/stk-push`, {
    method: 'POST',
    headers: syncHeaders(),
    body: JSON.stringify({
      ...payload,
      client_code: config.sync.shopClientCode
    })
  });
  const body = await readJson(res);
  return body.data;
}

async function getStatus(checkoutRequestId) {
  const res = await fetch(
    `${config.sync.vpsApiUrl}/mpesa/status/${encodeURIComponent(checkoutRequestId)}?client_code=${encodeURIComponent(config.sync.shopClientCode)}`,
    { headers: syncHeaders() }
  );
  const body = await readJson(res);
  return body.data;
}

async function testAuth() {
  const res = await fetch(`${config.sync.vpsApiUrl}/mpesa/test-auth`, {
    method: 'POST',
    headers: syncHeaders(),
    body: JSON.stringify({ client_code: config.sync.shopClientCode })
  });
  const body = await readJson(res);
  return body.data;
}

async function testStk() {
  const res = await fetch(`${config.sync.vpsApiUrl}/mpesa/test-stk`, {
    method: 'POST',
    headers: syncHeaders(),
    body: JSON.stringify({ client_code: config.sync.shopClientCode })
  });
  const body = await readJson(res);
  return body.data;
}

async function getSettings(clientId, userId) {
  const url =
    `${config.sync.vpsApiUrl}/mpesa/settings/${encodeURIComponent(clientId)}` +
    `?userId=${encodeURIComponent(userId)}&client_code=${encodeURIComponent(config.sync.shopClientCode)}`;
  const res = await fetch(url, { headers: syncHeaders() });
  const body = await readJson(res);
  return body.data;
}

async function saveSettings(clientId, payload) {
  const res = await fetch(`${config.sync.vpsApiUrl}/mpesa/settings/${encodeURIComponent(clientId)}`, {
    method: 'PUT',
    headers: syncHeaders(),
    body: JSON.stringify({
      ...payload,
      client_code: config.sync.shopClientCode
    })
  });
  const body = await readJson(res);
  return body.data;
}

module.exports = {
  isProxyConfigured,
  getConfig,
  getSettings,
  saveSettings,
  stkPush,
  getStatus,
  testAuth,
  testStk
};
