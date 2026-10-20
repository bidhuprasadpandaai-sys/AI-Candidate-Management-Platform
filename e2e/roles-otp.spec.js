import { expect, test } from "@playwright/test";
import { fakeSmtpServer } from "../apps/api/test/helpers/fakeSmtp.js";

const apiBase = "http://localhost:4311/api";
const admin = { name: "Playwright User", email: "playwright@example.com", password: "Strong123" }; // first account (admin)
const viewer = { name: "Pat Viewer", email: "pw-viewer@example.com", password: "Strong123" };

let smtp;

const companyName = "Roles Test Co";

test.beforeAll(async ({ request }) => {
  smtp = await fakeSmtpServer(4325);
  for (const user of [admin, viewer]) {
    const res = await request.post(`${apiBase}/auth/signup`, { data: user });
    expect([201, 409]).toContain(res.status());
  }
  const signin = await request.post(`${apiBase}/auth/signin`, { data: { email: admin.email, password: admin.password } });
  expect(signin.ok()).toBe(true);
  const created = await request.post(`${apiBase}/companies`, { data: { name: companyName } });
  expect([201, 409]).toContain(created.status());
});

test.afterAll(async () => {
  smtp?.server.close();
});

async function signInWithPassword(page, user) {
  await page.goto("/signin");
  await page.locator("#email").fill(user.email);
  await page.locator("input[type=password]").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Total candidates")).toBeVisible();
}

test("email-code sign-in: request a code, enter it, land signed in", async ({ page }) => {
  smtp.received.data = "";
  await page.goto("/signin");
  await page.getByRole("tab", { name: "Email code" }).click();
  await page.locator("#otp-email").fill(admin.email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.locator("#otp-code")).toBeVisible();

  let mail = "";
  await expect.poll(async () => {
    mail = smtp.received.data.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
    return /sign-in code is <strong>\d{6}<\/strong>/.test(mail);
  }, { timeout: 10000 }).toBe(true);
  const code = mail.match(/sign-in code is <strong>(\d{6})<\/strong>/)[1];

  await page.locator("#otp-code").fill(code);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByText("Total candidates")).toBeVisible();
  await expect(page).toHaveURL(/localhost:4411\/$/);
});

test("email-code sign-in: a wrong code shows an error", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("tab", { name: "Email code" }).click();
  await page.locator("#otp-email").fill(admin.email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.locator("#otp-code").fill("000001");
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByText("Invalid or expired code")).toBeVisible();
  await expect(page).toHaveURL(/\/signin$/);
});

test("a new user has no company and is read-only; the admin gives them a company and the recruiter role", async ({ browser }) => {
  // 1) New user: read-only, no company. No Admin module, no Add Candidate, and a notice explains why.
  const viewerPage = await (await browser.newContext()).newPage();
  await signInWithPassword(viewerPage, viewer);
  await expect(viewerPage.getByRole("button", { name: /^Admin/ })).toHaveCount(0);
  await expect(viewerPage.getByText("You are not assigned to a company yet")).toBeVisible();
  await viewerPage.getByRole("button", { name: /Candidates/ }).first().click();
  await expect(viewerPage.getByRole("button", { name: "Add Candidate" })).toHaveCount(0);

  // 2) Admin opens the Admin module, assigns the company and changes the role.
  const adminPage = await (await browser.newContext()).newPage();
  await signInWithPassword(adminPage, admin);
  await adminPage.getByRole("button", { name: /^Admin/ }).click();
  await expect(adminPage.getByText("Users, companies and roles")).toBeVisible();
  await expect(adminPage.getByText(viewer.email)).toBeVisible();

  await adminPage.getByLabel(`Company for ${viewer.email}`).click();
  await adminPage.getByRole("option", { name: companyName }).click();
  await expect(adminPage.getByText(/Company updated for Pat Viewer/)).toBeVisible();

  await adminPage.getByLabel(`Role for ${viewer.email}`).click();
  await adminPage.getByRole("option", { name: "Recruiter" }).click();
  await expect(adminPage.getByText(/Role updated for Pat Viewer/)).toBeVisible();

  // 3) Both changes show in the audit log.
  await adminPage.getByRole("tab", { name: /Audit log/ }).click();
  await expect(adminPage.getByText("user.role_changed").first()).toBeVisible();
  await expect(adminPage.getByText("user.company_changed").first()).toBeVisible();

  // 4) The (already signed-in) user gets recruiter powers in their company after a reload, no new sign-in.
  await viewerPage.reload();
  await expect(viewerPage.getByText("You are not assigned to a company yet")).toHaveCount(0);
  await viewerPage.getByRole("button", { name: /Candidates/ }).first().click();
  await expect(viewerPage.getByRole("button", { name: "Add Candidate" })).toBeVisible();

  // 5) The recruiter adds a candidate to their company without being asked for one.
  await viewerPage.getByRole("button", { name: "Add Candidate" }).click();
  await expect(viewerPage.getByLabel("Company", { exact: true })).toHaveCount(0);
  await viewerPage.locator("#c-name").fill("Company Scoped Candidate");
  await viewerPage.locator("#c-email").fill("scoped@example.com");
  await viewerPage.locator("#c-role").fill("Designer");
  await viewerPage.getByRole("button", { name: "Save Profile" }).click();
  await expect(viewerPage.getByText("Company Scoped Candidate").first()).toBeVisible();
});
