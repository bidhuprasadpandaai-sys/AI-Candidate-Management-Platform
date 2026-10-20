import { expect, test } from "@playwright/test";

const apiBase = "http://localhost:4311/api";
const user = { name: "Playwright User", email: "playwright@example.com", password: "Strong123", role: "Recruiter" };

const companyName = "Pipeline Test Co";

// Admins are not tied to a company, so the Add Candidate form asks which company the candidate belongs to.
async function pickCompany(page) {
  await page.getByLabel("Company", { exact: true }).click();
  await page.getByRole("option", { name: companyName }).click();
}

test.beforeAll(async ({ request }) => {
  const res = await request.post(`${apiBase}/auth/signup`, { data: user });
  expect([201, 409]).toContain(res.status());
  // create the company with the admin's session
  const signin = await request.post(`${apiBase}/auth/signin`, { data: { email: user.email, password: user.password } });
  expect(signin.ok()).toBe(true);
  const created = await request.post(`${apiBase}/companies`, { data: { name: companyName } });
  expect([201, 409]).toContain(created.status());
});

test("anonymous visitors are sent to the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("wrong password shows an error and stays on sign-in", async ({ page }) => {
  await page.goto("/signin");
  await page.locator("#email").fill(user.email);
  await page.locator("input[type=password]").fill("Wrong1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid credentials")).toBeVisible();
  await expect(page).toHaveURL(/\/signin$/);
});

test("recruiter signs in, sees the pipeline and uses the assistant", async ({ page }) => {
  await page.goto("/signin");
  await page.locator("#email").fill(user.email);
  await page.locator("input[type=password]").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Overview with dashboard metrics
  await expect(page).toHaveURL(/localhost:4411\/$/);
  await expect(page.getByTestId("brand-name")).toHaveText("TalentOS");
  await expect(page.getByText("Total candidates")).toBeVisible();

  // Candidates module lists the demo pipeline
  await page.getByRole("button", { name: /Candidates/ }).first().click();
  await expect(page.getByRole("button", { name: "Add Candidate" })).toBeVisible();
  await expect(page.getByText("Liam Carter").first()).toBeVisible();

  // Assistant answers from the rule-based engine
  await page.getByRole("button", { name: /AI Assistant/ }).click();
  await page.getByPlaceholder("Ask for a dashboard summary or top candidates").fill("show top candidates");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Top matching candidates")).toBeVisible();
});

test("session cookie is HttpOnly and not readable from the page", async ({ page, context }) => {
  await page.goto("/signin");
  await page.locator("#email").fill(user.email);
  await page.locator("input[type=password]").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Total candidates")).toBeVisible();
  const cookies = await context.cookies();
  const auth = cookies.find((c) => c.name === "auth_token");
  expect(auth?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain("auth_token");
});

test("the Add Candidate form asks admins which company the candidate belongs to", async ({ page }) => {
  await page.goto("/signin");
  await page.locator("#email").fill(user.email);
  await page.locator("input[type=password]").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Candidates/ }).first().click();
  await page.getByRole("button", { name: "Add Candidate" }).click();
  await page.locator("#c-name").fill("No Company");
  await page.locator("#c-email").fill("no-company@example.com");
  await page.locator("#c-role").fill("Dev");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page.getByText("Choose the company this candidate belongs to.")).toBeVisible();
});

test("recruiter adds a candidate through the form and it appears in the list", async ({ page }) => {
  await page.goto("/signin");
  await page.locator("#email").fill(user.email);
  await page.locator("input[type=password]").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Candidates/ }).first().click();

  await page.getByRole("button", { name: "Add Candidate" }).click();
  await page.locator("#c-name").fill("Playwright Candidate");
  await page.locator("#c-email").fill("pw-candidate@example.com");
  await page.locator("#c-role").fill("QA Lead");
  await pickCompany(page);
  await page.getByRole("button", { name: "Save Profile" }).click();

  await expect(page.getByText("Playwright Candidate").first()).toBeVisible();
});

test("adding a candidate with an invalid email shows the server validation message", async ({ page }) => {
  await page.goto("/signin");
  await page.locator("#email").fill(user.email);
  await page.locator("input[type=password]").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Candidates/ }).first().click();

  await page.getByRole("button", { name: "Add Candidate" }).click();
  await page.locator("#c-name").fill("Bad Email");
  await page.locator("#c-email").fill("not-an-email");
  await page.locator("#c-role").fill("Dev");
  await pickCompany(page);
  await page.getByRole("button", { name: "Save Profile" }).click();

  await expect(page.getByText("email must be a valid email address")).toBeVisible();
});
