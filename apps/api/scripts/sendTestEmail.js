// Usage: yarn email:test you@example.com
// Sends one harmless test message through the configured EMAIL_PROVIDER and reports the result.
// Prints the provider and host only, never credentials.
import "../src/config/env.js";
import { assertEmailConfig, getEmailConfig, sendEmail } from "../src/utils/email.js";

const to = process.argv[2];
if (!to) {
  console.error("Usage: yarn email:test you@example.com");
  process.exit(2);
}

try {
  assertEmailConfig();
} catch (error) {
  console.error(`Config problem: ${error.message}`);
  process.exit(1);
}

const config = getEmailConfig();
console.log(
  config.provider === "smtp"
    ? `Provider: smtp via ${config.host}:${config.port} (${config.secure ? "TLS" : "STARTTLS"}), from ${config.from}`
    : config.provider === "brevo"
      ? `Provider: Brevo API, from ${config.from}`
      : "Provider: console (nothing will be delivered; set EMAIL_PROVIDER=smtp or brevo in .env)"
);

const ok = await sendEmail(
  to,
  "TalentOS test email",
  "<p>This is a test email from your TalentOS API. If you can read this, email delivery works.</p>"
);

if (!ok) {
  console.error("Failed. Common causes: wrong SMTP login/key or BREVO_API_KEY, unverified sender in EMAIL_FROM, or (smtp only) blocked port 587.");
  process.exit(1);
}
console.log(config.provider !== "console" ? `Sent to ${to}. Check the inbox (and spam).` : "Done (console provider).");
