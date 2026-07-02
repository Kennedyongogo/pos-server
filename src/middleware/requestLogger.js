function requestLogger(req, res, next) {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.method === 'POST') {
    console.log('Body received:', JSON.stringify(req.body));
  }
  next();
}

module.exports = { requestLogger };
