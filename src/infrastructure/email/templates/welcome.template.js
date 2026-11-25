/**
 * --- SIGNUP WELCOME EMAIL ---
 * A branded HTML note sent once when an account is created.
 *
 * Design constraints are email-client constraints: tables instead of flex/grid,
 * inline CSS, a single raster logo attached by CID (many clients block or strip
 * SVG and remote images), and a plain-text alternative for clients that ask for
 * one. The brand mark is attached by the mailer, never fetched remotely.
 */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const firstNameOf = (name) => {
  const first = String(name || "").trim().split(/\s+/)[0];
  return first || "there";
};

const trimBase = (appUrl) => String(appUrl || "").replace(/\/+$/, "");

const STEPS = [
  {
    number: "01",
    title: "Add your first expense",
    body: "A coffee, a cab, a bill. One entry is enough to start your statement.",
  },
  {
    number: "02",
    title: "Give a category a budget",
    body: "Set a monthly ceiling and FinTrack will keep watch as you spend.",
  },
  {
    number: "03",
    title: "Read your month",
    body: "Your dashboard turns entries into one clear view of what is left.",
  },
];

const buildWelcomeText = ({ name, appUrl }) => {
  const base = trimBase(appUrl);
  const firstName = firstNameOf(name);

  return [
    `Hi ${firstName},`,
    "",
    "Welcome to FinTrack. Your account is ready, and your ledger is yours to shape.",
    "Income, spending, budgets and forecasts now live in one place, built only from what you enter.",
    "",
    "Three small steps to begin:",
    ...STEPS.map((step) => `${step.number}. ${step.title} - ${step.body}`),
    "",
    `Open your dashboard: ${base}/private/userdashboard`,
    "",
    "You are receiving this because you created a FinTrack account with this email.",
    `Manage notification settings: ${base}/private/settings?tab=notifications`,
    `Sign in: ${base}/login`,
    "",
    "FinTrack - Every rupee, accounted for.",
  ].join("\n");
};

const buildWelcomeHtml = ({ name, appUrl }) => {
  const base = trimBase(appUrl);
  const firstName = escapeHtml(firstNameOf(name));
  const dashboardUrl = `${base}/private/userdashboard`;
  const settingsUrl = `${base}/private/settings?tab=notifications`;
  const loginUrl = `${base}/login`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>Welcome to FinTrack</title>
    <style>
      @media only screen and (max-width: 600px) {
        .ft-shell { padding: 16px 10px !important; }
        .ft-pad { padding-left: 22px !important; padding-right: 22px !important; }
        .ft-title { font-size: 25px !important; line-height: 32px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5fa;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
      Your FinTrack account is ready. Here is where to begin.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f5fa" style="background-color:#f4f5fa;">
      <tr>
        <td class="ft-shell" align="center" style="padding:34px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td class="ft-pad" style="padding:24px 32px;border-bottom:1px solid #eceef5;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="42" valign="middle">
                      <img src="cid:fintrack-mark" width="38" height="38" alt="FinTrack" style="display:block;width:38px;height:38px;border:0;outline:none;text-decoration:none;" />
                    </td>
                    <td valign="middle" style="padding-left:11px;">
                      <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:19px;line-height:24px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">FinTrack</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="ft-pad" style="padding:34px 32px 0;">
                <p style="margin:0 0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#4f46e5;">
                  Welcome
                </p>
                <h1 class="ft-title" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:30px;line-height:38px;font-weight:700;letter-spacing:-0.03em;color:#0f172a;">
                  Your ledger is ready, ${firstName}.
                </h1>
                <p style="margin:16px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#475569;">
                  Welcome to FinTrack. Income, spending, budgets and forecasts now live in one place,
                  built only from what you enter. No noise, no shared data.
                </p>
              </td>
            </tr>

            <tr>
              <td class="ft-pad" style="padding:26px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7f0;border-radius:10px;background-color:#fbfbfe;">
                  ${STEPS.map(
                    (step, index) => `<tr>
                    <td width="52" valign="top" style="padding:${index === 0 ? "16px" : "12px"} 0 ${index === STEPS.length - 1 ? "16px" : "12px"} 16px;">
                      <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:18px;font-weight:700;color:#4f46e5;">${step.number}</span>
                    </td>
                    <td valign="top" style="padding:${index === 0 ? "16px" : "12px"} 16px ${index === STEPS.length - 1 ? "16px" : "12px"} 0;${index === STEPS.length - 1 ? "" : "border-bottom:1px solid #eceef5;"}">
                      <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;font-weight:600;color:#1e293b;">${step.title}</p>
                      <p style="margin:3px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;">${step.body}</p>
                    </td>
                  </tr>`,
                  ).join("")}
                </table>
              </td>
            </tr>

            <tr>
              <td class="ft-pad" style="padding:26px 32px 34px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="#4f46e5" style="border-radius:8px;">
                      <a href="${dashboardUrl}" style="display:inline-block;padding:13px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                        Open your dashboard
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:#94a3b8;">
                  Your first entry takes less than a minute.
                </p>
              </td>
            </tr>

            <tr>
              <td class="ft-pad" bgcolor="#f8fafc" style="padding:20px 32px;border-top:1px solid #eceef5;background-color:#f8fafc;">
                <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:#64748b;">
                  You are receiving this because you created a FinTrack account with this email.
                </p>
                <p style="margin:8px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:#64748b;">
                  <a href="${settingsUrl}" style="color:#4f46e5;text-decoration:underline;">Manage notification settings</a>
                  &nbsp;&middot;&nbsp;
                  <a href="${loginUrl}" style="color:#4f46e5;text-decoration:underline;">Sign in</a>
                </p>
                <p style="margin:14px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:17px;color:#94a3b8;">
                  FinTrack &middot; Every rupee, accounted for.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const buildWelcomeEmail = ({ name, appUrl }) => {
  const firstName = firstNameOf(name);

  return {
    subject: `Welcome to FinTrack, ${firstName}`,
    html: buildWelcomeHtml({ name, appUrl }),
    text: buildWelcomeText({ name, appUrl }),
  };
};

module.exports = {
  buildWelcomeEmail,
  firstNameOf,
};
