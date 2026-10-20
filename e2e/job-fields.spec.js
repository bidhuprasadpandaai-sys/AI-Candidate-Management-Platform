import { expect, test } from "@playwright/test";

const apiBase = "http://localhost:4311/api";
const admin = { name: "Playwright User", email: "playwright@example.com", password: "Strong123" };
const companyName = "Fields Test Co";
const jobTitle = "Registered Nurse";

test.beforeAll(async ({ request }) => {
  const res = await request.post(`${apiBase}/auth/signup`, { data: admin });
  expect([201, 409]).toContain(res.status());
  const signin = await request.post(`${apiBase}/auth/signin`, { data: { email: admin.email, password: admin.password } });
  expect(signin.ok()).toBe(true);
  const created = await request.post(`${apiBase}/companies`, { data: { name: companyName } });
  expect([201, 409]).toContain(created.status());
});

async function signIn(page) {
  await page.goto("/signin");
  await page.locator("#email").fill(admin.email);
  await page.locator("input[type=password]").fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Total candidates")).toBeVisible();
}

async function choose(page, label, optionName) {
  await page.getByLabel(label, { exact: true }).click();
  const exact = page.getByRole("option", { name: optionName, exact: true });
  const option = (await exact.count()) ? exact : page.getByRole("option", { name: optionName });
  await option.first().click();
}

test("set a company's currencies and facilities, create a job with pay and bill rates, and hit its application limit", async ({ page }) => {
  await signIn(page);

  // 1) Company settings: preset currencies and this company's own facilities
  await page.getByRole("button", { name: /^Admin/ }).click();
  await page.getByRole("tab", { name: /Companies/ }).click();
  const row = page.getByRole("row", { name: new RegExp(companyName) });
  await expect(row).toContainText("USD");
  await row.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("dialog").locator(".p-multiselect").click();
  await page.getByRole("option", { name: /EUR/ }).click();
  await page.getByRole("dialog").getByText("Work sites this company hires for.").click(); // closes the list (Escape would close the dialog)
  await page.getByRole("button", { name: "Add facility" }).click();
  await page.getByLabel("Facility name").nth(0).fill("Main Hospital");
  await page.getByLabel("Facility location").nth(0).fill("Boston");
  await page.getByLabel("Facility address").nth(0).fill("1 Main Street");
  await page.getByLabel("Facility pin code").nth(0).fill("02108");
  await page.getByRole("button", { name: "Add facility" }).click();
  await page.getByLabel("Facility name").nth(1).fill("North Clinic");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(`Settings saved for "${companyName}".`)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(companyName) })).toContainText("USD, EUR");

  // 2) Add a job using those lists, with rates, an expiry date and a limit of one application
  await page.getByRole("button", { name: /^Jobs/ }).click();
  await page.getByRole("button", { name: "Add job" }).first().click();
  await choose(page, "Company", companyName);
  await page.getByLabel("Job title").fill(jobTitle);
  await choose(page, "Employment type", "Part time");
  // A new facility can be added right here; it is saved for this company and selected for the job
  await page.getByRole("button", { name: "Add new facility" }).click();
  const facilityDialog = page.getByRole("group", { name: "New facility" });
  await expect(facilityDialog).toContainText("Other companies never see it");
  await facilityDialog.getByLabel("Facility name").fill("Riverside Centre");
  await facilityDialog.getByLabel("Facility location").fill("Austin");
  await facilityDialog.getByLabel("Facility address").fill("5 River Road");
  await facilityDialog.getByLabel("Facility pin code").fill("73301");
  await facilityDialog.getByRole("button", { name: "Add facility" }).click();
  await expect(facilityDialog).toBeHidden();
  await expect(page.getByLabel("Facility", { exact: true })).toContainText("Riverside Centre · Austin");
  await choose(page, "Facility", "Main Hospital");
  await choose(page, "Currency", "EUR");
  await page.getByLabel("Pay rate minimum").fill("40");
  await page.getByLabel("Pay rate maximum").fill("60");
  await page.getByLabel("Bill rate minimum").fill("70");
  await page.getByLabel("Bill rate maximum").fill("90");
  await page.getByLabel("Job expiry date").fill("2099-12-31");
  await page.getByLabel("Maximum applications").fill("1");
  await page.getByLabel("Description").fill("Nursing role. 2+ years of experience.");
  await expect(page.locator('[data-test="rate-summary"]')).toHaveText("Pay EUR 40 – 60 / hour");
  if (process.env.SHOTS_DIR) {
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/job-dialog-top.png` });
    await page.getByRole("dialog").getByText("Pay and billing").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/job-dialog-pay.png` });
  }
  await page.getByRole("dialog").getByRole("button", { name: "Add job" }).click();
  await expect(page.getByText(`Job "${jobTitle}" created.`)).toBeVisible();

  const jobRow = page.getByRole("row", { name: new RegExp(jobTitle) });
  await expect(jobRow).toContainText("Part time");
  await expect(jobRow.locator('[data-test="pay-rate"]')).toHaveText("EUR 40 – 60 / hour");
  await expect(jobRow.locator('[data-test="bill-rate"]')).toHaveText("EUR 70 – 90 / hour");
  await expect(jobRow).toContainText("Main Hospital");
  await expect(jobRow).toContainText("2099-12-31");
  await expect(jobRow.locator('[data-test="applications"]')).toHaveText("0 / 1");

  // 3) A pay maximum below the minimum is refused before anything is sent
  await jobRow.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Pay rate maximum").fill("30");
  await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Pay rate minimum cannot be higher than the maximum.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // 4) The first candidate can apply; once the limit of 1 is reached the job is no longer offered
  await page.getByRole("button", { name: /^Candidates/ }).first().click();
  await page.getByRole("button", { name: "Add Candidate" }).click();
  await choose(page, "Company", companyName);
  await page.locator("#c-name").fill("First Applicant");
  await page.locator("#c-email").fill("first.applicant@example.com");
  await page.locator("#c-role").fill("Nurse");
  await choose(page, "Job", jobTitle);
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page.getByText("First Applicant").first()).toBeVisible();

  await page.getByRole("button", { name: "Add Candidate" }).click();
  await choose(page, "Company", companyName);
  await page.getByLabel("Job", { exact: true }).click();
  await expect(page.getByRole("option", { name: jobTitle })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: /^Jobs/ }).click();
  const fullRow = page.getByRole("row", { name: new RegExp(jobTitle) });
  await expect(fullRow.locator('[data-test="applications"]')).toHaveText("1 / 1");
  await expect(fullRow).toContainText("Full");
});
