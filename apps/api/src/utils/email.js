export async function sendEmail(to, subject, html) {
  // Placeholder email sender – logs to console.
  // In production replace with real email service (SendGrid, SES, etc.)
  console.log(`\n--- Email Sent ---\nTo: ${to}\nSubject: ${subject}\nContent:\n${html}\n------------------\n`);
  return true;
}
