const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

module.exports = {
  port: Number(process.env.PORT) || 4001,
  nodeEnv: process.env.NODE_ENV || 'development',
  serveClient: process.env.SERVE_CLIENT === '1',
  clientBuildPath: path.join(__dirname, '..', '..', '..', 'client', 'build'),
  mpesa: {
    consumerKey: (process.env.MPESA_CONSUMER_KEY || '').trim(),
    consumerSecret: (process.env.MPESA_CONSUMER_SECRET || '').trim(),
    shortcode: (process.env.MPESA_SHORTCODE || '').trim(),
    passkey: (process.env.MPESA_PASSKEY || '').trim(),
    callbackUrl: (process.env.MPESA_CALLBACK_URL || '').trim(),
    env: (process.env.MPESA_ENV || 'sandbox').toLowerCase().trim()
  }
};
