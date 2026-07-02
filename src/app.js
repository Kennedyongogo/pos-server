const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config/config');
const mpesaService = require('./services/mpesaService');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const productsRoutes = require('./routes/productsRoutes');
const transactionsRoutes = require('./routes/transactionsRoutes');
const mpesaRoutes = require('./routes/mpesaRoutes');

const app = express();

const clientBuildPath = config.clientBuildPath;
const serveClient =
  config.serveClient || fs.existsSync(path.join(clientBuildPath, 'index.html'));

app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/mpesa', mpesaRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    mode: 'local',
    serveClient,
    mpesa: mpesaService.isConfigured(),
    timestamp: new Date().toISOString()
  });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, error: 'API route not found' });
  }
  next();
});

if (serveClient) {
  app.use(express.static(clientBuildPath));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

app.use(errorHandler);

async function initializeApp() {
  const { testConnections } = require('./config/database');
  await testConnections();
  return true;
}

const appInitialized = initializeApp();

module.exports = { app, appInitialized, serveClient };
