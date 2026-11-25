const path = require("path");
const nodemailer = require("nodemailer");
const logger = require("../logger");
const { buildWelcomeEmail } = require("./templates/welcome.template");

// Raster copy of the violet FinTrack mark, attached inline so the email does
// not depend on a remote image host (and does not break when images are slow).
const WELCOME_LOGO_PATH = path.join(
  __dirname,
  "../../assets/email/fintrack-mark.png",
);

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

// Brevo's SMTP key is distinct from an API key: an API key will connect but
// fail authentication. BREVO_SMTP_KEY is the explicit name; BREVO_PASS is kept
// for existing deployments.
const getSmtpPassword = () =>
  process.env.BREVO_SMTP_KEY?.trim() || process.env.BREVO_PASS?.trim();

const isEmailConfigured = () =>
  Boolean(process.env.BREVO_USER?.trim() && getSmtpPassword());

const getFromAddress = () => {
  const configured = process.env.MAIL_FROM?.trim();
  return configured || `"FinTrack" <${process.env.BREVO_USER}>`;
};

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
        pass: getSmtpPassword(),
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
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: "Reset your Fintrack password",
    text: buildText({ name, resetUrl, expiresInMinutes }),
    html: buildHtml({ name, resetUrl, expiresInMinutes }),
  });

  // Deliberately no link, token or recipient in the log record.
  logger.info("email.password_reset_sent");
};

/**
 * Sends the one-time signup welcome note.
 *
 * The logo travels as a CID attachment, so the message renders branded even in
 * clients that block remote images. Delivery is the caller's concern: signup
 * must still succeed when SMTP is unavailable.
 */
const sendWelcomeEmail = async ({ to, name, appUrl }) => {
  const { subject, html, text } = buildWelcomeEmail({ name, appUrl });

  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject,
    text,
    html,
    attachments: [
      {
        filename: "fintrack-mark.png",
        path: WELCOME_LOGO_PATH,
        cid: "fintrack-mark",
      },
    ],
  });

  // No recipient or name in the log record.
  logger.info("email.welcome_sent");
};

module.exports = {
  isEmailConfigured,
  sendPasswordResetEmail,
  sendWelcomeEmail,
};
