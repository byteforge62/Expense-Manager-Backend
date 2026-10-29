
const { S3Client } = require("@aws-sdk/client-s3");

let s3;

const getS3Client = () => {
  const requiredVariables = [
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ];

  const missingVariables = requiredVariables.filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missingVariables.length > 0) {
    const error = new Error("S3 storage is not configured.");
    error.statusCode = 503;
    throw error;
  }

  if (!s3) {
    s3 = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  return s3;
};

module.exports = { getS3Client };
