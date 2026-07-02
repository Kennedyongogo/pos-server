function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  const status = err.status || 500;
  const message =
    process.env.NODE_ENV === 'production' && status === 500
      ? 'Something went wrong'
      : err.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    error: message
  });
}

module.exports = { errorHandler };
