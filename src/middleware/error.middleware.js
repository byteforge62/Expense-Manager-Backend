
const multer = require("multer");

const errorHandler = (err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;

    return res.status(statusCode).json({
      success: false,
      message:
        err.code === "LIMIT_FILE_SIZE"
          ? "Uploaded file exceeds the 5 MB limit"
          : "Invalid file upload",
    });
  }

  if (
    err.message ===
    "Only JPEG, PNG, and WebP images are allowed"
  ) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    console.error(err);
  }

  return res.status(statusCode).json({
    success: false,
    message:
      statusCode >= 500
        ? "Internal server error"
        : err.message || "Request failed",
  });
};

module.exports = errorHandler;
