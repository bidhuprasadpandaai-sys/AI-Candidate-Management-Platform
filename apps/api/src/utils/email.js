// Placeholder email sender: no real email is sent yet.
// Message bodies contain verification and password-reset links, which are credentials,
// so they are never logged by default. In development only, set EMAIL_DEBUG_LOG=true
// to print the full message to the console. Replace with a real provider (SendGrid, SES, ...).

function maskRecipient(address) {
  const [local = "", domain = ""] = String(address).split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function sendEmail(to, subject, html) {
  const debug = process.env.EMAIL_DEBUG_LOG === "true" && process.env.NODE_ENV !== "production";

  if (debug) {
    console.log(`\n--- Email (debug) ---\nTo: ${to}\nSubject: ${subject}\nContent:\n${html}\n---------------------\n`);
  } else {
    console.log(`Email not sent (no provider configured): to ${maskRecipient(to)}, subject "${subject}"`);
  }
  return true;
}
