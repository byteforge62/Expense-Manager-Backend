const sendSuccess = (
  res,
  statusCode = 200,
  message = "Success",
  data = null,
  meta = null,
) => {
  const body = {
    success: true,
    message,
    data,
  };

  // `meta` is additive: existing clients keep reading `data`.
  if (meta) {
    body.meta = meta;
  }

  return res.status(statusCode).json(body);
};

const sendError = (
  res,
  statusCode = 500,
  message = "Something went wrong",
  errors = null,
) => {
  const body = {
    success: false,
    message,
  };

  if (errors) {
    body.errors = errors;
  }

  if (res.req?.id) {
    body.requestId = res.req.id;
  }

  return res.status(statusCode).json(body);
};

/**
 * Wraps an async route handler so a rejected promise reaches the error
 * middleware instead of escaping as an unhandled rejection.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  sendSuccess,
  sendError,
  asyncHandler,
};
