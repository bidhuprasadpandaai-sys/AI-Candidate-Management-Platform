import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { SAMPLE_RESUME_LINES, makePdf } from "../apps/api/test/helpers/fixtures.js";

const apiBase = "http://localhost:4311/api";
const admin = { name: "Playwright User", email: "playwright@example.com", password: "Strong123" };
const companyName = "Jobs Test Co";
const jobTitle = "Staff Platform Engineer";
const secondJob = "Brand Designer";

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
  // prefer an option with exactly this name (the board's job list adds the company name to its labels)
  const exact = page.getByRole("option", { name: optionName, exact: true });
  const option = (await exact.count()) ? exact : page.getByRole("option", { name: optionName });
  await option.first().click();
}

test("create a job, upload a resume into it, and move the candidate across the pipeline board", async ({ page }) => {
  await signIn(page);

  // 1) Add job (with a job description the fit score can use)
  await page.getByRole("button", { name: /^Jobs/ }).click();
  await expect(page.getByText("Job openings")).toBeVisible();
  await page.getByRole("button", { name: "Add job" }).first().click();
  await choose(page, "Company", companyName);
  await page.getByLabel("Job title").fill(jobTitle);
  await page.getByLabel("Department").fill("Engineering");
  await page.getByLabel("Location").fill("Remote");
  await page.getByLabel("Description").fill("We need 5+ years of experience building APIs with Node.js, PostgreSQL, AWS and Docker.");
  await page.getByRole("dialog").getByRole("button", { name: "Add job" }).click();
  await expect(page.getByText(`Job "${jobTitle}" created.`)).toBeVisible();
  await expect(page.getByRole("cell", { name: new RegExp(jobTitle) })).toBeVisible();

  // a second, very different job: the same candidate gets a different fit score for it
  await page.getByRole("button", { name: "Add job" }).first().click();
  await choose(page, "Company", companyName);
  await page.getByLabel("Job title").fill(secondJob);
  await page.getByLabel("Description").fill("We need 3+ years of experience in Figma and CSS design systems.");
  await page.getByRole("dialog").getByRole("button", { name: "Add job" }).click();
  await expect(page.getByText(`Job "${secondJob}" created.`)).toBeVisible();
  // exactly one Add job button on the page while the list has jobs
  await expect(page.getByRole("button", { name: "Add job" })).toHaveCount(1);

  // 2) The resume is uploaded inside the Add Candidate popup, which fills in the form
  await page.getByRole("button", { name: /^Candidates/ }).first().click();
  await expect(page.getByRole("button", { name: "Upload resume" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add Candidate" }).click();
  await expect(page.getByText("Autofill from a resume")).toBeVisible();
  await choose(page, "Company", companyName);
  await page.getByLabel("Resume file").setInputFiles({ name: "Jane Doe CV.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_RESUME_LINES) });

  // 3) The form is filled from the file; the user checks it and links the job
  await expect(page.locator("#c-name")).toHaveValue("Jane Q. Doe");
  await expect(page.locator("#c-email")).toHaveValue("jane.doe@example.com");
  await expect(page.locator("#c-phone")).toHaveValue("+14155550123");
  await expect(page.locator("#c-role")).toHaveValue("Senior Backend Engineer");
  await expect(page.locator("#c-skills")).toHaveValue(/Node\.js/);
  await expect(page.getByRole("dialog").getByText("Jane Doe CV.pdf")).toBeVisible();
  await choose(page, "Job", jobTitle);
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page.getByText("Jane Q. Doe").first()).toBeVisible();

  // The table shows profile completion (name, email, phone, role, location, years, skills, summary and resume are all there)
  const row = page.getByRole("row", { name: /Jane Q\. Doe/ });
  await expect(row.locator('[data-test="profile-score"]')).toHaveText("100%");
  // the Match column shows the fit for the job the candidate applied to
  await expect(row.locator('[data-test="match-cell"]')).toContainText(jobTitle);

  // 4) The candidate shows up on the job's pipeline board, in Screening
  await page.getByRole("button", { name: /^Jobs/ }).click();
  await page.getByRole("tab", { name: /Pipeline board/ }).click();
  await choose(page, "Job", jobTitle);
  const screening = page.getByRole("region", { name: "Screening column" });
  await expect(screening.getByRole("button", { name: "Jane Q. Doe" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Interview column" }).getByRole("button", { name: "Jane Q. Doe" })).toHaveCount(0);

  await expect(screening.locator('[data-test="profile-score"]')).toHaveText("100%");
  const boardFit = Number(await screening.locator('[data-test="card-fit"]').innerText());
  expect(boardFit).toBeGreaterThanOrEqual(85);

  // 5) Drag the card to Interview; the change is saved on the server
  await screening.locator(".board-card", { hasText: "Jane Q. Doe" }).dragTo(page.getByRole("region", { name: "Interview column" }));
  await expect(page.getByRole("region", { name: "Interview column" }).getByRole("button", { name: "Jane Q. Doe" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Jobs/ }).click();
  await page.getByRole("tab", { name: /Pipeline board/ }).click();
  await choose(page, "Job", jobTitle);
  await expect(page.getByRole("region", { name: "Interview column" }).getByRole("button", { name: "Jane Q. Doe" })).toBeVisible();

  // 6) The stage menu works without dragging (keyboard and touch friendly)
  await page.getByLabel("Move Jane Q. Doe to stage").selectOption("offer");
  await expect(page.getByRole("region", { name: "Offer column" }).getByRole("button", { name: "Jane Q. Doe" })).toBeVisible();

  // 7) The candidate panel: resume, profile completion and the fit for each job
  await page.getByRole("button", { name: "Jane Q. Doe" }).click();
  await expect(page.locator('[data-test="resume-state"]')).toHaveText("On file");
  await expect(page.getByText("Everything we ask for is filled in.")).toBeVisible();
  await expect(page.locator('[data-test="stage-hint"]')).toBeVisible();
  await page.getByRole("tab", { name: /^Jobs/ }).click();
  await expect(page.locator('[data-test="app-job"]')).toHaveText(jobTitle);
  const firstFit = Number(await page.locator('[data-test="fit-score"]').innerText());
  expect(firstFit).toBeGreaterThanOrEqual(85);
  await expect(page.locator('[data-test="fit-details"] .fit-chip-match')).toHaveCount(4);
  await expect(page.locator('[data-test="fit-details"] .fit-chip-missing')).toHaveCount(0);

  // 8) Apply the same candidate to a second job: its own, lower fit score and its own stage
  await choose(page, "Add to a job", secondJob);
  await page.getByRole("button", { name: "Add to job" }).click();
  await expect(page.locator('[data-test="application"]')).toHaveCount(2);
  const fits = (await page.locator('[data-test="fit-score"]').allInnerTexts()).map(Number);
  expect(fits[0]).toBeGreaterThan(fits[1] + 20);
  await expect(page.getByLabel(`Stage for ${secondJob}`)).toHaveValue("screening");
  await expect(page.getByLabel(`Stage for ${jobTitle}`)).toHaveValue("offer");

  // 9) The second job's board shows her in Screening with her fit for THAT job
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Jobs/ }).click();
  await page.getByRole("tab", { name: /Pipeline board/ }).click();
  await choose(page, "Job", secondJob);
  const designScreening = page.getByRole("region", { name: "Screening column" });
  await expect(designScreening.getByRole("button", { name: "Jane Q. Doe" })).toBeVisible();
  const designFit = Number(await designScreening.locator('[data-test="card-fit"]').innerText());
  expect(designFit).toBeLessThan(boardFit - 20);

  // ...while the first job's board still has her in Offer
  await choose(page, "Job", jobTitle);
  await expect(page.getByRole("region", { name: "Offer column" }).getByRole("button", { name: "Jane Q. Doe" })).toBeVisible();

  // 10) The candidate table shows both jobs' match scores
  await page.getByRole("button", { name: /^Candidates/ }).first().click();
  await expect(page.getByRole("row", { name: /Jane Q\. Doe/ }).locator(".match-chip")).toHaveCount(2);

  // 11) The original resume can be downloaded
  await page.getByRole("row", { name: /Jane Q\. Doe/ }).getByText("Jane Q. Doe").first().click();
  await page.getByRole("tab", { name: /^Documents/ }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download resume" }).click()]);
  expect(download.suggestedFilename()).toBe("Jane Doe CV.pdf");
  const saved = await download.path();
  expect(fs.readFileSync(saved).subarray(0, 5).toString()).toBe("%PDF-");
});

test("an unsupported file in the Add Candidate popup is rejected with a clear message", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /^Candidates/ }).first().click();
  await page.getByRole("button", { name: "Add Candidate" }).click();
  await choose(page, "Company", companyName);
  await page.getByLabel("Resume file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("just a note") });
  await expect(page.getByText("Choose a PDF or Word (.docx) file.")).toBeVisible();
  // the normal form is still usable
  await expect(page.locator("#c-name")).toBeEditable();
  await expect(page.getByRole("button", { name: "Save Profile" })).toBeEnabled();
});
