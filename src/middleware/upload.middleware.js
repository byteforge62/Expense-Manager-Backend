const multer = require("multer");

/**
 * Profile-image upload pipeline.
 *
 * Multer accepts the file into memory, `validateImageSignature` then confirms
 * the bytes really are the image type the client claimed, and the user service
 * streams the buffer to object storage. Keeping both steps together means the
 * accepted mime types and the checked magic numbers can never drift apart.
 */

const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, and WebP images are allowed"));
    }

    cb(null, true);
  },
});

const validateImageSignature = (req, res, next) => {
  if (!req.file) {
    return next();
  }

  const { buffer, mimetype } = req.file;

  const isJpeg =
    mimetype === "image/jpeg" &&
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  const isPng =
    mimetype === "image/png" &&
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

  const isWebp =
    mimetype === "image/webp" &&
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";

  if (!isJpeg && !isPng && !isWebp) {
    const error = new Error(
      "Uploaded file content does not match a supported image type",
    );
    error.statusCode = 400;
    return next(error);
  }

  next();
};

module.exports = {
  upload,
  validateImageSignature,
};
