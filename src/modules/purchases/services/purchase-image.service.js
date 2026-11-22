const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { PutObjectCommand } = require("@aws-sdk/client-s3");

const { getS3Client } = require("../../../config/s3");
const { ValidationError, AppError } = require("../../../errors/AppError");
const logger = require("../../../infrastructure/logger");

/**
 * Product-image storage.
 *
 * Reuses the profile-image pipeline (same multer limits and magic-number
 * check). If S3 is configured the object is stored there; otherwise it is
 * written under `<project>/uploads/purchases` and served read-only by the API,
 * so image upload works locally without cloud credentials.
 */

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const LOCAL_UPLOAD_ROOT = path.join(__dirname, "..", "..", "..", "..", "uploads");
const LOCAL_PURCHASE_DIR = path.join(LOCAL_UPLOAD_ROOT, "purchases");

const isS3Configured = () =>
  ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_BUCKET_NAME"].every(
    (name) => Boolean(process.env[name]?.trim()),
  );

const uploadPurchaseImage = async (file, { userId, baseUrl }) => {
  if (!file) {
    throw new ValidationError("No image uploaded");
  }

  const extension = EXTENSIONS[file.mimetype];

  if (!extension) {
    throw new ValidationError("Unsupported image type");
  }

  const key = `purchases/${userId}/${crypto.randomUUID()}.${extension}`;

  if (isS3Configured()) {
    try {
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );

      return {
        url: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
        storage: "s3",
      };
    } catch (error) {
      // Misconfigured or unreachable object storage must not block recording a
      // purchase image: the file falls back to local storage and the failure is
      // logged for the operator (never surfaced with credentials).
      logger.warn("purchase.image_s3_upload_failed", {
        userID: String(userId),
        errorName: error?.name,
      });
    }
  }

  try {
    await fs.mkdir(LOCAL_PURCHASE_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_PURCHASE_DIR, path.basename(key)), file.buffer);
  } catch (error) {
    logger.error("purchase.image_write_failed", { userID: String(userId), error });
    throw new AppError("Product image could not be stored", 503);
  }

  return {
    url: `${baseUrl}/uploads/purchases/${path.basename(key)}`,
    storage: "local",
  };
};

module.exports = {
  uploadPurchaseImage,
  isS3Configured,
  LOCAL_UPLOAD_ROOT,
};
