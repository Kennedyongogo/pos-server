const http = require('http');
const { app, appInitialized } = require('./app');
const config = require('./config/config');

const PORT = config.port;

async function createServer() {
  await appInitialized;

  const server = http.createServer(app);

  server.listen(PORT, () => {
    console.log('========================================');
    console.log('Carlynve POS — Local server running');
    console.log(`API:  http://localhost:${PORT}/api`);
    console.log(`Environment: ${config.nodeEnv}`);
    if (config.serveClient || require('fs').existsSync(require('path').join(config.clientBuildPath, 'index.html'))) {
      console.log(`Shop: http://127.0.0.1:${PORT}`);
      console.log('(Production build — works without internet)');
    } else {
      console.log('Client build not found — API only');
      console.log('Run: cd client && npm run build');
    }
    console.log('========================================');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${PORT} is already in use.`);
      console.error('Another POS server is already running (check other terminals or START_POS.bat).');
      console.error('To stop it: taskkill /F /IM node.exe');
      console.error(`Or use a different port: set PORT=4002 && npm start\n`);
      process.exit(1);
    }
    console.error('Server failed to start:', err.message);
    process.exit(1);
  });

  return server;
}

module.exports = { createServer };

if (require.main === module) {
  createServer();
}
