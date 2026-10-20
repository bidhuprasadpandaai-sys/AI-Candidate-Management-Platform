import { expect, test } from "@playwright/test";

const apiBase = "http://localhost:4311/api";
const admin = { name: "Playwright User", email: "playwright@example.com", password: "Strong123" };
const member = { name: "Brand Member", email: "brand.member@example.com", password: "Strong123" };
const companyName = "White Label Health";
// A real 2x2 PNG, so the preview and the sidebar can actually draw it
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7bXnIAAAAASUVORK5CYII=", "base64");
const shots = process.env.SHOTS_DIR;

test.beforeAll(async ({ request }) => {
  expect([201, 409]).toContain((await request.post(`${apiBase}/auth/signup`, { data: admin })).status());
  expect([201, 409]).toContain((await request.post(`${apiBase}/auth/signup`, { data: member })).status());
  expect((await request.post(`${apiBase}/auth/signin`, { data: { email: admin.email, password: admin.password } })).ok()).toBe(true);
  const created = await request.post(`${apiBase}/companies`, { data: { name: companyName } });
  expect([201, 409]).toContain(created.status());
  const users = (await (await request.get(`${apiBase}/users`)).json()).users;
  const companies = (await (await request.get(`${apiBase}/companies`)).json()).companies;
  const memberId = users.find((u) => u.email === member.email).id;
  const companyId = companies.find((c) => c.name === companyName).id;
  expect((await request.patch(`${apiBase}/users/${memberId}`, { data: { accessRole: "recruiter", companyId } })).ok()).toBe(true);
});

async function signIn(page, user) {
  await page.goto("/signin");
  await page.locator("#email").fill(user.email);
  await page.locator("input[type=password]").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an admin brands a company and its users see the logo, name and colours", async ({ page, browser }) => {
  await signIn(page, admin);
  await expect(page.getByText("Total candidates")).toBeVisible();
  // The platform default before any company branding
  await expect(page.getByTestId("brand-name")).toHaveText("TalentOS");
  if (shots) await page.screenshot({ path: `${shots}/overview-default.png`, fullPage: false });

  await page.getByRole("button", { name: /^Admin/ }).click();
  await page.getByRole("tab", { name: /Companies/ }).click();
  await page.getByRole("row", { name: new RegExp(companyName) }).getByRole("button", { name: /Branding/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Logo file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(dialog.getByAltText("Company logo preview")).toBeVisible();
  await dialog.getByLabel("Display name").fill("White Label Care");
  await dialog.getByLabel("Tagline").fill("Care that scales");
  await dialog.getByLabel("Primary colour code").fill("#0f766e");
  await dialog.getByLabel("Accent colour code").fill("#f59e0b");
  await dialog.getByLabel("Support email").fill("hr@whitelabel.example.com");
  if (shots) await page.screenshot({ path: `${shots}/branding-dialog.png` });
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByText(`Branding saved for "${companyName}".`)).toBeVisible();

  // An invalid colour is refused with a message
  await page.getByRole("row", { name: new RegExp(companyName) }).getByRole("button", { name: /Branding/ }).click();
  await page.getByRole("dialog").getByLabel("Primary colour code").fill("teal");
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByRole("dialog").getByText(/primaryColor must be a colour/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  // A member of that company sees the branding everywhere
  const context = await browser.newContext();
  const memberPage = await context.newPage();
  await signIn(memberPage, member);
  await expect(memberPage.getByTestId("brand-name")).toHaveText("White Label Care");
  await expect(memberPage.getByTestId("brand-mark").locator("img")).toBeVisible();
  await expect(memberPage.getByTestId("company-chip")).toContainText("White Label Care");
  const primary = await memberPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary-color").trim());
  expect(primary).toBe("#0f766e");
  expect(await memberPage.title()).toBe("White Label Care");
  if (shots) await memberPage.screenshot({ path: `${shots}/overview-branded.png` });
  await memberPage.getByRole("button", { name: /^Candidates/ }).click();
  if (shots) await memberPage.screenshot({ path: `${shots}/candidates-branded.png` });
  await context.close();
});
