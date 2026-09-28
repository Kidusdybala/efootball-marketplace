class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

function errorHandler(err, c) {
  let error = { ...err, message: err.message, stack: err.stack };
  error.statusCode = err.statusCode || 500;
  error.status = err.status || 'error';

  if (err.name === 'CastError') {
    const message = `Invalid ${err.path}: ${err.value}`;
    error = new AppError(message, 400);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `Duplicate ${field}. Please use another value.`;
    error = new AppError(message, 400);
  }

  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((el) => el.message);
    const message = `Invalid input: ${errors.join('. ')}`;
    error = new AppError(message, 400);
  }

  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token. Please log in again.', 401);
  }

  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired. Please log in again.', 401);
  }

  if (process.env.NODE_ENV === 'development') {
    return c.json({
      success: false,
      status: error.status,
      message: error.message,
      stack: error.stack,
    }, error.statusCode);
  }

  if (error.isOperational) {
    return c.json({
      success: false,
      message: error.message,
    }, error.statusCode);
  }

  console.error('ERROR:', err);
  return c.json({
    success: false,
    message: 'Something went wrong!',
  }, 500);
}

export { AppError, errorHandler };
