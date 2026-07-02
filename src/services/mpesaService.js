const mpesaSettingsService = require('./mpesaSettingsService');

/** @type {Map<string, object>} */
const pendingPayments = new Map();

function isConfiguredForClient(clientId) {
  return Boolean(mpesaSettingsService.getDecryptedConfig(clientId));
}

function getMpesaConfigForClient(clientId) {
  return mpesaSettingsService.getDecryptedConfig(clientId);
}

function timestamp() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const ts = `${get('year')}${get('month')}${get('day')}${hour}${get('minute')}${get('second')}`;
  if (ts.length !== 14) {
    throw new Error(`Invalid M-Pesa timestamp length (${ts.length})`);
  }
  return ts;
}

function normalizeDarajaSecret(value) {
  return String(value || '').replace(/\s/g, '');
}

function mapStkError(message, audit) {
  const text = String(message || '');
  if (!/wrong credentials/i.test(text)) return text;

  let detail =
    'STK rejected: wrong shortcode or passkey (OAuth only checks consumer key/secret).';
  if (audit?.env === 'sandbox') {
    detail += ` Stored shortcode: ${audit.shortcode || '—'}, passkey length: ${audit.passkeyLength || 0}.`;
    if (audit.sandboxPasskeyMatch === false) {
      detail += ' Passkey does not match the standard sandbox value — click Fill sandbox defaults and save.';
    }
  } else {
    detail += ' Re-enter shortcode and Lipa Na M-Pesa Online passkey from Daraja, then save.';
  }
  return detail;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('7')) return `254${digits}`;
  return null;
}

async function readJsonResponse(res, label) {
  const text = await res.text();
  if (!text || !text.trim()) {
    if (label === 'OAuth' && res.status === 400) {
      throw new Error(
        'OAuth failed (HTTP 400): Invalid Consumer Key or Consumer Secret for this shop.'
      );
    }
    throw new Error(
      `${label}: empty response from M-Pesa (HTTP ${res.status}). Check internet and Daraja status.`
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: invalid response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function getAccessToken(mpesaConfig) {
  const auth = Buffer.from(`${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`).toString('base64');
  const res = await fetch(
    `${mpesaConfig.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const data = await readJsonResponse(res, 'OAuth');
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.errorMessage ||
      data.error_description ||
      data.error ||
      `Failed to get M-Pesa access token (HTTP ${res.status})`
    );
  }
  return data.access_token;
}


async function initiateStkPush({ clientId, phone, amount, accountReference, transactionDesc }) {
  const mpesaConfig = getMpesaConfigForClient(clientId);
  if (!mpesaConfig) {
    const gap = mpesaSettingsService.describeConfigurationGap(clientId);
    throw new Error(gap || 'M-Pesa is not configured for this shop.');
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new Error('Invalid phone number. Use 07XXXXXXXX or 2547XXXXXXXX');
  }

  const kesAmount = Math.max(1, Math.round(Number(amount)));
  const shortcode = normalizeDarajaSecret(mpesaConfig.shortcode);
  const passkey = normalizeDarajaSecret(mpesaConfig.passkey);
  const token = await getAccessToken(mpesaConfig);
  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64');

  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: ts,
    TransactionType: 'CustomerPayBillOnline',
    Amount: kesAmount,
    PartyA: normalizedPhone,
    PartyB: shortcode,
    PhoneNumber: normalizedPhone,
    CallBackURL: mpesaConfig.callbackUrl,
    AccountReference: String(accountReference || 'POS').substring(0, 12),
    TransactionDesc: String(transactionDesc || 'POS Sale').substring(0, 13)
  };

  const res = await fetch(`${mpesaConfig.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await readJsonResponse(res, 'STK push');
  if (!res.ok || data.ResponseCode !== '0') {
    const raw =
      data.errorMessage ||
      data.ResponseDescription ||
      data.error ||
      'STK push request failed';
    const audit = mpesaSettingsService.auditStkCredentials(clientId);
    console.log('M-Pesa STK rejected:', {
      clientId,
      shortcode,
      passkeyLength: passkey.length,
      env: mpesaConfig.env,
      daraja: raw
    });
    throw new Error(mapStkError(raw, audit));
  }

  const checkoutRequestId = data.CheckoutRequestID;
  pendingPayments.set(checkoutRequestId, {
    status: 'pending',
    clientId,
    phone: normalizedPhone,
    amount: kesAmount,
    merchantRequestId: data.MerchantRequestID,
    updatedAt: new Date().toISOString()
  });

  return {
    checkoutRequestId,
    merchantRequestId: data.MerchantRequestID,
    customerMessage: data.CustomerMessage,
    phone: normalizedPhone,
    amount: kesAmount
  };
}

function parseCallbackMetadata(metadata) {
  const items = metadata?.Item || [];
  const result = {};
  for (const item of items) {
    if (item.Name === 'MpesaReceiptNumber') result.mpesaReceiptNumber = String(item.Value);
    if (item.Name === 'PhoneNumber') result.phone = String(item.Value);
    if (item.Name === 'Amount') result.amount = Number(item.Value);
  }
  return result;
}

function handleStkCallback(payload) {
  const stk = payload?.Body?.stkCallback;
  if (!stk?.CheckoutRequestID) {
    return { ok: false, error: 'Invalid callback payload' };
  }

  const checkoutRequestId = stk.CheckoutRequestID;
  const existing = pendingPayments.get(checkoutRequestId) || {
    status: 'pending',
    updatedAt: new Date().toISOString()
  };

  const resultCode = Number(stk.ResultCode);
  const meta = parseCallbackMetadata(stk.CallbackMetadata);

  if (resultCode === 0) {
    pendingPayments.set(checkoutRequestId, {
      ...existing,
      status: 'completed',
      resultCode,
      resultDesc: stk.ResultDesc,
      mpesaReceiptNumber: meta.mpesaReceiptNumber,
      phone: meta.phone || existing.phone,
      amount: meta.amount ?? existing.amount,
      updatedAt: new Date().toISOString()
    });
  } else {
    pendingPayments.set(checkoutRequestId, {
      ...existing,
      status: 'failed',
      resultCode,
      resultDesc: stk.ResultDesc || 'Payment was not completed',
      updatedAt: new Date().toISOString()
    });
  }

  return { ok: true, checkoutRequestId, resultCode };
}

function getPaymentStatus(checkoutRequestId) {
  return pendingPayments.get(checkoutRequestId) || { status: 'unknown' };
}

module.exports = {
  isConfiguredForClient,
  getMpesaConfigForClient,
  getAccessToken,
  initiateStkPush,
  handleStkCallback,
  getPaymentStatus
};
