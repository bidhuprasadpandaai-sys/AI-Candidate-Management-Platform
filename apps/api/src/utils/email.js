import nodemailer from "nodemailer";

// Email sender. EMAIL_PROVIDER selects the transport:
//   console (default): nothing is sent; only a masked recipient and the subject are logged.
//   smtp: sends through any SMTP server (Brevo, Resend, Mailgun, SES SMTP, Mailpit, ...).
// Message bodies contain verification and password-reset links, which are credentials,
// so they are never logged by default. In development only, set EMAIL_DEBUG_LOG=true
// to print the full message.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function getEmailConfig(env = process.env) {
  const provider = String(env.EMAIL_PROVIDER || "console").trim().toLowerCase();
  const port = Number(env.SMTP_PORT) || 587;
  return {
    provider,
    host: String(env.SMTP_HOST || "").trim(),
    port,
    // Port 465 uses implicit TLS; 587/2525 upgrade with STARTTLS.
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
    user: String(env.SMTP_USER || "").trim(),
    pass: String(env.SMTP_PASS || ""),
    from: String(env.EMAIL_FROM || "").trim(),
    debug: env.EMAIL_DEBUG_LOG === "true" && env.NODE_ENV !== "production"
  };
}

// Call once at startup so a misconfigured provider fails fast instead of at first reset.
export function assertEmailConfig(env = process.env) {
  const config = getEmailConfig(env);
  if (config.provider === "console") {
    if (env.NODE_ENV === "production") {
      console.warn("EMAIL_PROVIDER=console in production: no email will be delivered.");
    }
    return;
  }
  if (config.provider !== "smtp") {
    throw new Error(`EMAIL_PROVIDER must be "console" or "smtp" (got "${config.provider}")`);
  }
  if (!config.host || !config.from) {
    throw new Error("EMAIL_PROVIDER=smtp requires SMTP_HOST and EMAIL_FROM (see .env.example)");
  }
  if (Boolean(config.user) !== Boolean(config.pass)) {
    throw new Error("SMTP_USER and SMTP_PASS must be set together");
  }
}

function maskRecipient(address) {
  const [local = "", domain = ""] = String(address).split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function htmlToText(html) {
  return String(html)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .trim();
}

let cachedTransport;
let cachedKey = "";

function getTransport(config) {
  const key = JSON.stringify([config.host, config.port, config.secure, config.user, config.pass]);
  if (!cachedTransport || key !== cachedKey) {
    cachedTransport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      // Remote servers must upgrade to TLS (STARTTLS); a local dev catcher like Mailpit is plain.
      requireTLS: !config.secure && !LOCAL_HOSTS.has(config.host),
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000
    });
    cachedKey = key;
  }
  return cachedTransport;
}

// Returns true when sent (or accepted by the console provider), false on any failure.
// Never throws, so callers cannot leak whether an address exists through a 500 response,
// and never logs the body, credentials or recipient address.
export async function sendEmail(to, subject, html, { env = process.env, transport } = {}) {
  const config = getEmailConfig(env);

  if (!EMAIL.test(String(to))) {
    console.warn("Email not sent: invalid recipient address");
    return false;
  }
  const cleanSubject = String(subject).replace(/[\r\n]+/g, " ").slice(0, 200);

  if (config.provider !== "smtp") {
    if (config.debug) {
      console.log(`\n--- Email (debug) ---\nTo: ${to}\nSubject: ${cleanSubject}\nContent:\n${html}\n---------------------\n`);
    } else {
      console.log(`Email not sent (EMAIL_PROVIDER=console): to ${maskRecipient(to)}, subject "${cleanSubject}"`);
    }
    return true;
  }

  try {
    await (transport || getTransport(config)).sendMail({
      from: config.from,
      to,
      subject: cleanSubject,
      html,
      text: htmlToText(html)
    });
    console.log(`Email sent: to ${maskRecipient(to)}, subject "${cleanSubject}"`);
    return true;
  } catch (error) {
    console.warn(`Email failed: to ${maskRecipient(to)}, ${error?.code || error?.name || "Error"}`);
    return false;
  }
}
