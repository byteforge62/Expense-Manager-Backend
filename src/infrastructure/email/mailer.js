const nodemailer = require("nodemailer");
const logger = require("../logger");

/**
 * --- OUTBOUND EMAIL ---
 * Uses the provider this project is already wired for: Brevo's SMTP relay with
 * the BREVO_USER / BREVO_PASS credentials from `.env.example`, through the
 * `nodemailer` dependency that already ships with the backend. No second email
 * provider and no new dependency.
 *
 * One transport per process. Credentials are only read here and are never
 * logged; failures propagate to the caller, which decides what the client sees.
 */

let transporter = null;

const isEmailConfigured = () =>
  Boolean(process.env.BREVO_USER?.trim() && process.env.BREVO_PASS?.trim());

const getTransporter = () => {
  if (!isEmailConfigured()) {
    const error = new Error("Email delivery is not configured");
    error.statusCode = 503;
    throw error;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST?.trim() || "smtp-relay.brevo.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.BREVO_USER,
        pass: process.env.BREVO_PASS,
      },
    });
  }

  return transporter;
};

const buildText = ({ name, resetUrl, expiresInMinutes }) =>
  [
    `Hi ${name || "there"},`,
    "",
    "We received a request to reset the password for your Fintrack account.",
    `Open this link to choose a new password (valid for ${expiresInMinutes} minutes):`,
    "",
    resetUrl,
    "",
    "If you did not ask for this, you can ignore this email: your password will not change.",
  ].join("\n");

const buildHtml = ({ name, resetUrl, expiresInMinutes }) => `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;color:#1f2937">
    <h2 style="margin:0 0 12px">Reset your Fintrack password</h2>
    <p>Hi ${name || "there"},</p>
    <p>We received a request to reset the password for your Fintrack account.</p>
    <p>
      <a href="${resetUrl}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1976d2;color:#fff;text-decoration:none;font-weight:600">
        Choose a new password
      </a>
    </p>
    <p style="font-size:13px;color:#6b7280">
      This link is valid for ${expiresInMinutes} minutes and can be used once.
      If you did not ask for this, you can ignore this email.
    </p>
  </div>
`;

const sendPasswordResetEmail = async ({
  to,
  name,
  resetUrl,
  expiresInMinutes = 30,
}) => {
  const from = process.env.MAIL_FROM?.trim() || process.env.BREVO_USER;

  await getTransporter().sendMail({
    from,
    to,
    subject: "Reset your Fintrack password",
    text: buildText({ name, resetUrl, expiresInMinutes }),
    html: buildHtml({ name, resetUrl, expiresInMinutes }),
  });

  // Deliberately no link, token or recipient in the log record.
  logger.info("email.password_reset_sent");
};

module.exports = {
  isEmailConfigured,
  sendPasswordResetEmail,
};
