import { expect, test } from "@playwright/test";
import { SAMPLE_RESUME_LINES, makePdf } from "../apps/api/test/helpers/fixtures.js";

const apiBase = "http://localhost:4311/api";
const admin = { name: "Playwright User", email: "playwright@example.com", password: "Strong123" };
const companyName = "Documents Test Co";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7bXnIAAAAASUVORK5CYII=", "base64");
const shots = process.env.SHOTS_DIR;
let companyId;

test.beforeAll(async ({ request }) => {
  expect([201, 409]).toContain((await request.post(`${apiBase}/auth/signup`, { data: admin })).status());
  expect((await request.post(`${apiBase}/auth/signin`, { data: { email: admin.email, password: admin.password } })).ok()).toBe(true);
  expect([201, 409]).toContain((await request.post(`${apiBase}/companies`, { data: { name: companyName } })).status());
  companyId = (await (await request.get(`${apiBase}/companies`)).json()).companies.find((c) => c.name === companyName).id;
  // Two existing candidates: one for the documents and resume prompt, one whose email is on a resume we will upload later
  const base = { companyId, skills: ["Patient care"], location: "Boston", experienceYears: 3 };
  expect([201, 409]).toContain((await request.post(`${apiBase}/candidates`, { data: { ...base, name: "Dana Docs", email: "dana.docs@example.com", role: "Nurse" } })).status());
  expect([201, 409]).toContain((await request.post(`${apiBase}/candidates`, { data: { ...base, name: "Jane Existing", email: "jane.doe@example.com", role: "Nurse" } })).status());
});

// Leave the shared test server as it was, so list-length assumptions in other specs still hold
test.afterAll(async ({ request }) => {
  await request.post(`${apiBase}/auth/signin`, { data: { email: admin.email, password: admin.password } });
  const { candidates } = await (await request.get(`${apiBase}/candidates?limit=100`)).json();
  for (const candidate of candidates.filter((c) => c.companyId === companyId)) await request.delete(`${apiBase}/candidates/${candidate.id}`);
});

async function signIn(page) {
  await page.goto("/signin");
  await page.locator("#email").fill(admin.email);
  await page.locator("input[type=password]").fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Total candidates")).toBeVisible();
}

async function openCandidate(page, name) {
  await page.getByRole("button", { name: /^Candidates/ }).first().click();
  await page.getByRole("row", { name: new RegExp(name) }).getByText(name).first().click();
  await expect(page.getByRole("tab", { name: /^Overview/ })).toBeVisible();
}

test("the overlay is split into tabs, documents expire, and a resume only updates the profile when asked", async ({ page }) => {
  await signIn(page);
  await openCandidate(page, "Dana Docs");

  // Tabs: one topic at a time
  await expect(page.getByRole("tab")).toHaveCount(5);
  await expect(page.locator("#panel-overview")).toBeVisible();
  await expect(page.locator("#panel-documents")).toBeHidden();
  if (shots) await page.screenshot({ path: `${shots}/overlay-overview.png` });

  // Documents: add one that already expired
  await page.getByRole("tab", { name: /^Documents/ }).click();
  await expect(page.locator("#panel-overview")).toBeHidden();
  await expect(page.locator('[data-test="no-documents"]')).toBeVisible();
  await page.getByRole("button", { name: "Add document" }).click();
  await page.getByLabel("Document file").setInputFiles({ name: "old-id.png", mimeType: "image/png", buffer: png });
  await expect(page.getByLabel("Document title")).toHaveValue("old-id");
  await page.getByLabel("Document title").fill("Driver licence");
  await page.getByLabel("Document type").click();
  await page.getByRole("option", { name: "License", exact: true }).click();
  await page.getByLabel("Expiry date", { exact: true }).fill("2020-01-31");
  await page.getByRole("button", { name: "Upload" }).click();
  const item = page.locator('[data-test="document"]').filter({ hasText: "Driver licence" });
  await expect(item.locator('[data-test="doc-expiry"]')).toContainText("Expired on Jan 31, 2020");
  await expect(page.getByRole("tab", { name: /^Documents/ }).locator(".tab-badge.alert")).toHaveText("1");
  if (shots) await page.screenshot({ path: `${shots}/overlay-documents.png` });

  // Renewing the date clears the Expired mark
  await item.getByRole("button", { name: "Edit Driver licence" }).click();
  await page.getByLabel("Edit expiry date").fill("2099-01-31");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(item.locator('[data-test="doc-expiry"]')).not.toContainText("Expired");
  await expect(page.getByRole("tab", { name: /^Documents/ }).locator(".tab-badge.alert")).toHaveCount(0);

  // The document can be downloaded
  const [download] = await Promise.all([page.waitForEvent("download"), item.getByRole("button", { name: "Download Driver licence" }).click()]);
  expect(download.suggestedFilename()).toBe("old-id.png");

  // A resume from the candidate's own screen is stored but changes nothing until the user agrees
  await page.getByLabel("Attach resume").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_RESUME_LINES) });
  const prompt = page.getByRole("dialog", { name: "Update the profile from this resume?" });
  await expect(prompt).toBeVisible();
  await expect(prompt).not.toContainText("Jane Q. Doe"); // the name is never offered
  if (shots) await page.screenshot({ path: `${shots}/overlay-resume-prompt.png` });
  await prompt.getByRole("button", { name: "Keep current profile" }).click();
  await expect(page.locator('[data-test="resume-state"]')).toHaveText("On file");
  await page.getByRole("tab", { name: /^Overview/ }).click();
  await expect(page.locator(".drawer-header")).toContainText("Nurse");
  await expect(page.locator(".drawer-header")).not.toContainText("Senior Backend Engineer");
  await expect(page.locator("#panel-overview")).not.toContainText("Jane Q. Doe");
});

test("a resume of someone who is already a candidate does not fill the Add Candidate form", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /^Candidates/ }).first().click();
  await page.getByRole("button", { name: "Add Candidate" }).click();
  await page.getByLabel("Company", { exact: true }).click();
  await page.getByRole("option", { name: companyName, exact: true }).click();
  await page.getByLabel("Resume file").setInputFiles({ name: "jane.pdf", mimeType: "application/pdf", buffer: makePdf([...SAMPLE_RESUME_LINES, "Extra line so this is a different file"]) });
  await expect(page.locator('[data-test="existing-candidate"]')).toContainText("Jane Existing is already a candidate");
  await expect(page.locator("#c-name")).toHaveValue("");
  await expect(page.locator("#c-email")).toHaveValue("");
});
