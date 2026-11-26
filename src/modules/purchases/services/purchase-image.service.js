const crypto = require("crypto");
const fs = require("fs/promises");
const { createReadStream } = require("fs");
const path = require("path");
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const jwt = require("jsonwebtoken");

const { getS3Client } = require("../../../config/s3");
const {
  ValidationError,
  AppError,
  NotFoundError,
  ForbiddenError,
} = require("../../../errors/AppError");
const logger = require("../../../infrastructure/logger");

/**
 * Product-image storage and access.
 *
 * Files are written to object storage when it is configured and to
 * `<project>/uploads/purchases` otherwise. They are never statically served:
 * every image is read through `GET /api/purchases/images/:file` with a
 * short-lived signed token, minted only for the owner of the purchase.
 *
 * That closes two holes at once:
 * - no public directory listing or guessable read path;
 * - another signed-in user cannot fetch an image they do not own, because a
 *   valid token is bound to the owner id and the storage key.
 *
 * The token is a domain-separated JWT (HS256), so it can never be confused
 * with an API access token or a realtime stream token.
 */

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;

const LOCAL_UPLOAD_ROOT = path.join(__dirname, "..", "..", "..", "..", "uploads");
const LOCAL_PURCHASE_DIR = path.join(LOCAL_UPLOAD_ROOT, "purchases");

const IMAGE_TOKEN_TYPE = "purchase_image";
const IMAGE_TOKEN_AUDIENCE = "purchase-image";
const IMAGE_SECRET_CONTEXT = "fintrack:purchase-image-url:v1";

const DEFAULT_TTL_SECONDS = 60 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

const ttlSeconds = () => {
  const configured = Number(process.env.PURCHASE_IMAGE_URL_TTL_SECONDS);

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_TTL_SECONDS;
  }

  return Math.min(Math.max(Math.floor(configured), MIN_TTL_SECONDS), MAX_TTL_SECONDS);
};

// A random per-process fallback only matters if the app starts without
// JWT_SECRET (validateEnv rejects that in a real deployment); links minted with
// it simply stop working after a restart instead of being signed with "".
const FALLBACK_SECRET = crypto.randomBytes(32).toString("hex");

/** Domain-separated signing key: never the API JWT secret itself. */
const getImageSecret = () =>
  crypto
    .createHmac("sha256", String(process.env.JWT_SECRET || FALLBACK_SECRET))
    .update(IMAGE_SECRET_CONTEXT)
    .digest("hex");

const isS3Configured = () =>
  ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_BUCKET_NAME"].every(
    (name) => Boolean(process.env[name]?.trim()),
  );

const extensionOf = (file) => path.extname(String(file || "")).slice(1).toLowerCase();

const isSafeFile = (file) =>
  typeof file === "string" &&
  SAFE_FILE.test(file) &&
  Boolean(MIME_BY_EXTENSION[extensionOf(file)]);

const isOwnStorageKey = (key) =>
  typeof key === "string" && key.startsWith("purchases/") && key.split("/").length >= 3;

/**
 * Turns a stored `imageUrl` into a freshly signed, expiring read URL.
 *
 * Only URLs that clearly belong to this API are rewritten. External product
 * images (for example a marketplace thumbnail) are returned untouched, because
 * they are not ours to sign or proxy.
 */
const signStoredImageUrl = (imageUrl, { userId, baseUrl } = {}) => {
  if (!imageUrl || !userId || !baseUrl) {
    return imageUrl;
  }

  const raw = String(imageUrl);
  let key = null;

  // Uploaded through this API: `/uploads/purchases/<file>` (canonical, legacy)
  // or `/api/purchases/images/<file>?token=...` (previous signed link).
  const localMatch = raw.match(/\/(?:api\/purchases\/images|uploads\/purchases)\/([^/?#]+)/);

  if (localMatch && isSafeFile(localMatch[1])) {
    key = `purchases/${userId}/${localMatch[1]}`;
  }

  // Object storage: only objects inside our own bucket are proxied.
  if (!key && isS3Configured()) {
    const bucket = process.env.AWS_BUCKET_NAME;
    const marker = `${bucket}.s3.`;
    const index = raw.indexOf(marker);

    if (index !== -1) {
      const keyStart = raw.indexOf("/", raw.indexOf(".amazonaws.com"));
      const candidate = keyStart === -1 ? "" : decodeURIComponent(raw.slice(keyStart + 1));

      if (isOwnStorageKey(candidate) && candidate.startsWith(`purchases/${userId}/`)) {
        key = candidate;
      }
    }
  }

  if (!key) {
    return imageUrl;
  }

  const token = jwt.sign(
    { sub: String(userId), typ: IMAGE_TOKEN_TYPE, key },
    getImageSecret(),
    {
      algorithm: "HS256",
      audience: IMAGE_TOKEN_AUDIENCE,
      expiresIn: ttlSeconds(),
    },
  );

  return `${baseUrl}/api/purchases/images/${path.basename(key)}?token=${encodeURIComponent(token)}`;
};

/**
 * Normalises an uploaded/proxied image URL before it is stored.
 *
 * The database keeps a stable, token-free reference; a new signed link is
 * minted every time the purchase is read. External URLs are stored as given.
 */
const canonicalizeImageUrl = (imageUrl) => {
  if (!imageUrl) {
    return imageUrl;
  }

  const raw = String(imageUrl);
  const match = raw.match(/\/(?:api\/purchases\/images|uploads\/purchases)\/([^/?#]+)/);

  if (!match || !isSafeFile(match[1])) {
    return raw;
  }

  return `/uploads/purchases/${match[1]}`;
};

/**
 * Verifies a read token and returns the storage key it authorises.
 * Throws for anything malformed, expired, forged, or not bound to `sub`.
 */
const verifyImageToken = (token) => {
  const decoded = jwt.verify(String(token || ""), getImageSecret(), {
    algorithms: ["HS256"],
    audience: IMAGE_TOKEN_AUDIENCE,
  });

  if (decoded?.typ !== IMAGE_TOKEN_TYPE || !decoded.sub || !isOwnStorageKey(decoded.key)) {
    const error = new ForbiddenError("Image link is not authorised");
    throw error;
  }

  const expectedPrefix = `purchases/${decoded.sub}/`;

  if (!decoded.key.startsWith(expectedPrefix)) {
    throw new ForbiddenError("Image link is not authorised");
  }

  return { userId: String(decoded.sub), key: String(decoded.key) };
};

/**
 * Reads an authorised image. Local storage wins; when the API is configured
 * with object storage the object is streamed from there, so the bucket itself
 * does not need to be public.
 */
const openPurchaseImage = async ({ userId, key, file }) => {
  if (
    !userId ||
    !isOwnStorageKey(key) ||
    !key.startsWith(`purchases/${userId}/`) ||
    path.posix.basename(key) !== file ||
    !isSafeFile(file)
  ) {
    throw new ForbiddenError("Image link is not authorised");
  }

  const extension = extensionOf(file);
  const contentType = MIME_BY_EXTENSION[extension];

  // Local files live in a per-owner directory, so a token that claims another
  // user's key cannot reach that user's file even with a stolen filename. The
  // local copy is checked first because an upload falls back to disk when
  // object storage is briefly unavailable.
  const filePath = path.join(LOCAL_PURCHASE_DIR, userId, file);
  const stat = await fs.stat(filePath).catch(() => null);

  if (stat?.isFile()) {
    return {
      contentType,
      contentLength: stat.size,
      stream: () => createReadStream(filePath),
    };
  }

  if (!isS3Configured()) {
    throw new NotFoundError("Image not found");
  }

  try {
    const object = await getS3Client().send(
      new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key }),
    );

    return {
      contentType: MIME_BY_EXTENSION[extensionOf(key)] || contentType,
      contentLength: object.ContentLength,
      stream: () => object.Body,
    };
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      throw new NotFoundError("Image not found");
    }

    logger.warn("purchase.image_read_failed", { errorName: error?.name });
    throw new AppError("Product image could not be read", 503);
  }
};

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
        url: signStoredImageUrl(`/uploads/purchases/${path.basename(key)}`, {
          userId,
          baseUrl,
        }),
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
    const userDir = path.join(LOCAL_PURCHASE_DIR, String(userId));
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(path.join(userDir, path.basename(key)), file.buffer);
  } catch (error) {
    logger.error("purchase.image_write_failed", { userID: String(userId), error });
    throw new AppError("Product image could not be stored", 503);
  }

  return {
    url: signStoredImageUrl(`/uploads/purchases/${path.basename(key)}`, {
      userId,
      baseUrl,
    }),
    storage: "local",
  };
};

module.exports = {
  uploadPurchaseImage,
  canonicalizeImageUrl,
  signStoredImageUrl,
  verifyImageToken,
  openPurchaseImage,
  isS3Configured,
  LOCAL_UPLOAD_ROOT,
  LOCAL_PURCHASE_DIR,
};
