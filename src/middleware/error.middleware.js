const multer = require("multer");
const mongoose = require("mongoose");
const { ZodError } = require("zod");
const logger = require("../infrastructure/logger");

const UPLOAD_MESSAGE = "Only JPEG, PNG, and WebP images are allowed";

/**
 * Central error translator.
 *
 * Contract: always `{ success: false, message, ... }`. Internal details
 * (stack traces, Mongo errors, provider messages) never reach the client;
 * 5xx responses are logged with the request id for correlation.
 */
const errorHandler = (err, req, res, _next) => {
  const requestId = req?.id;
  const log = req?.log || logger.child({ requestId });
  let statusCode = err.statusCode || 500;
  let message = err.message || "Request failed";
  let errors;

  if (err instanceof multer.MulterError) {
    statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Uploaded file exceeds the 5 MB limit"
        : "Invalid file upload";
  } else if (err.message === UPLOAD_MESSAGE) {
    statusCode = 400;
    message = UPLOAD_MESSAGE;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = "Validation failed";
    errors = err.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = `Invalid value for ${err.path || "identifier"}`;
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = "Validation failed";
    errors = Object.values(err.errors).map((issue) => ({
      field: issue.path,
      message: issue.message,
    }));
  } else if (err instanceof mongoose.Error.DocumentNotFoundError) {
    statusCode = 404;
    message = "Resource not found";
  } else if (err.code === 11000) {
    statusCode = 409;
    message = "A record with the same value already exists";
  } else if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Invalid or expired token";
  } else if (err.type === "entity.parse.failed") {
    statusCode = 400;
    message = "Malformed JSON body";
  } else if (err.type === "entity.too.large") {
    statusCode = 413;
    message = "Request body too large";
  }

  if (statusCode >= 500) {
    log.error("request.failed", {
      error: err,
      status: statusCode,
      method: req?.method,
      path: req?.path,
    });
    // Never leak internals; operators correlate through the request id.
    message = "Internal server error";
    errors = undefined;
  } else {
    log.debug("request.rejected", {
      status: statusCode,
      message,
      method: req?.method,
      path: req?.path,
    });
  }

  const body = {
    success: false,
    message,
  };

  if (errors) {
    body.errors = errors;
  }

  if (requestId) {
    body.requestId = requestId;
  }

  return res.status(statusCode).json(body);
};

module.exports = errorHandler;
