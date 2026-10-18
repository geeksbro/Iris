import { expect, test as base, type Download, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const screenshotDirectory = path.resolve("test-results", "screenshots");

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: async ({ page }, provide) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`console: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

    await provide(errors);

    expect(errors, "the browser emitted console or page errors").toEqual([]);
  },
});

// The lock screen greets by the hour, without a name on a device that never chose one.
const greeting = /^(Buongiorno|Buon pomeriggio|Buonasera|Good morning|Good afternoon|Good evening)(, .+)?$/;

/*
 * A new device starts empty and offers the guided tour (features/onboarding).
 * These tests are about the ledger, so they decline the tour and load the
 * fictional example archive from Settings, as a person trying IRIS would.
 */
async function loadExampleArchive(page: Page) {
  const tour = page.locator(".tour-panel");
  await tour.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  if (await tour.isVisible()) await page.keyboard.press("Escape");
  await page.locator("#rail-settings").click();
  await page.getByRole("button", { name: /^(Dati|Data)/ }).click();
  await page.getByRole("button", { name: /^(Carica esempio|Load example)$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /^(Carica esempio|Load example)$/ }).click();
  await expect(page.locator(".toast")).toContainText(/(Archivio di esempio caricato|Example archive loaded)/);
  await page.locator(".sidebar nav").getByRole("button", { name: /^(Panoramica|Overview)$/ }).click();
}

// The tests read the interface in English unless a test chooses otherwise.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem("wealth-language")) window.localStorage.setItem("wealth-language", "en");
  });
});

/*
 * Unlocks with the PIN. A PIN whose length the lock screen knows unlocks on
 * its last digit; one it does not know waits for the button.
 */
async function unlock(page: Page, pin = "2026") {
  await page.getByLabel("PIN", { exact: true }).fill(pin);
  const button = page.getByRole("button", { name: /unlock dashboard/i });
  if (await button.isEnabled().catch(() => false)) await button.click({ timeout: 2_000 }).catch(() => undefined);
  await page.getByTestId("wealth-hero").waitFor({ state: "visible", timeout: 15_000 });
}

async function openDashboard(page: Page) {
  await page.goto("/");

  const pin = page.getByLabel("PIN", { exact: true });
  await expect(pin.or(page.getByTestId("wealth-hero")).first()).toBeVisible({ timeout: 30_000 });

  if (await page.getByLabel("Confirm PIN").isVisible()) {
    await pin.fill("2026");
    await page.getByLabel("Confirm PIN").fill("2026");
    await page.getByRole("button", { name: /create pin/i }).click();
    await page.getByTestId("wealth-hero").waitFor({ state: "visible" });
    await loadExampleArchive(page);
  } else if (await pin.isVisible()) {
    await unlock(page);
  }

  await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("9.420,40");
}

// A view, from the rail (other controls may share its name).
function railButton(page: Page, name: string) {
  return page.locator(".sidebar nav").getByRole("button", { name, exact: true });
}

// Language and the eye live in the top bar.
function topBar(page: Page) {
  return page.locator(".topbar");
}

// Settings › Data, where the backup is exported; back to the Overview after.
async function exportBackup(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#rail-settings").click();
  await page.getByRole("button", { name: /^Data/ }).click();
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  await railButton(page, "Overview").click();
  return download;
}

async function readDownload(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.body, `${label} body overflow`).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.document, `${label} document overflow`).toBeLessThanOrEqual(dimensions.viewport);
}

test("gates the dashboard behind the local PIN", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Create your PIN" })).toBeVisible();
  await expect(page.getByTestId("wealth-hero")).toHaveCount(0);

  await page.getByLabel("PIN", { exact: true }).fill("2026");
  await page.getByLabel("Confirm PIN").fill("2026");
  await page.getByRole("button", { name: /create pin/i }).click();

  // A new device: an empty archive, and the guided tour offered once.
  await expect(page.getByRole("dialog", { name: "Welcome to IRIS" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("0,00");

  await page.evaluate(() => window.sessionStorage.clear());
  await page.reload();

  await expect(page.getByRole("heading", { name: greeting })).toBeVisible();
  await expect(page.getByTestId("wealth-hero")).toHaveCount(0);

  // A PIN of known length is checked on its last digit; otherwise on the button.
  // The button only when the last digit has not already been checked: clicking
  // after it would submit the emptied field and replace the message.
  await page.getByLabel("PIN", { exact: true }).fill("0000");
  // Next's route announcer is an alert too: the PIN's message is the one that says so.
  const incorrect = page.getByRole("alert").filter({ hasText: /incorrect pin/i });
  await incorrect.waitFor({ timeout: 2_000 }).catch(() =>
    page.getByRole("button", { name: /unlock dashboard/i }).click({ timeout: 2_000 }).catch(() => undefined),
  );
  await expect(incorrect).toBeVisible();

  await unlock(page);

  await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("0,00");
  // Skipped once, not offered again.
  await expect(page.getByRole("dialog", { name: "Welcome to IRIS" })).toHaveCount(0);
});

test("interrupts the session after 120 seconds of inactivity and requires the PIN again", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  test.setTimeout(210_000);
  await openDashboard(page);
  await expect(page.getByTestId("wealth-hero")).toBeVisible();

  await page.waitForTimeout(122_000);

  await expect(page.getByRole("heading", { name: greeting })).toBeVisible();
  await expect(page.getByTestId("wealth-hero")).toHaveCount(0);
  await expect(page.getByText(/interrupted after 2 minutes of inactivity/i)).toBeVisible();

  await unlock(page);

  await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("9.420,40");
});

test("masks every money amount with the eye toggle and persists the choice", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await page.addInitScript(() => window.localStorage.setItem("wealth-language", "en"));
  await openDashboard(page);
  await expect(page.getByTestId("wealth-hero")).toBeVisible();

  const profile = topBar(page);
  await profile.getByRole("button", { name: "Hide amounts" }).click();

  await expect(page.locator(".money.is-masked").first()).toBeVisible();
  await expect(page.locator(".wealth-hero h1 .sensitive.is-hidden")).toBeVisible();
  await expect(profile.getByRole("button", { name: "Show amounts" }).locator(".icon-swap")).toHaveAttribute("data-state", "hidden");

  await page.reload();
  await expect(page.getByTestId("wealth-hero")).toBeVisible();

  await expect(page.locator(".money.is-masked").first()).toBeVisible();
  const reopened = topBar(page);
  await expect(reopened.getByRole("button", { name: "Show amounts" }).locator(".icon-swap")).toHaveAttribute("data-state", "hidden");

  await reopened.getByRole("button", { name: "Show amounts" }).click();

  await expect(page.locator(".money.is-masked")).toHaveCount(0);
  await expect(reopened.getByRole("button", { name: "Hide amounts" }).locator(".icon-swap")).toHaveAttribute("data-state", "shown");
});

test("shows language and the eye in the top bar at every width, and keeps export and import in Settings", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await page.addInitScript(() => window.localStorage.setItem("wealth-language", "en"));
  await openDashboard(page);

  for (const width of [1920, 1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(700);
    const bar = page.getByRole("banner");
    for (const name of [/export/i, /import/i]) {
      await expect(bar.getByRole("button", { name }), `${width}: ${name}`).toHaveCount(0);
    }
    for (const name of ["Switch to Italian", "Hide amounts"]) {
      const control = bar.getByRole("button", { name, exact: true });
      await expect(control, `${width}: ${name}`).toBeVisible();
      const box = await control.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width, `${width}: ${name} inside the viewport`).toBe(true);
    }
    await expect(bar.getByRole("button", { name: "Profile" })).toBeVisible();
    // Updating the balances is the round button at the bottom left, on every page.
    await expect(page.locator(".update-balances-fab")).toBeVisible();
    await expectNoHorizontalOverflow(page, `${width} top bar`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#rail-settings").click();
  await page.getByRole("button", { name: /^Data/ }).click();
  await expect(page.getByRole("button", { name: "Export backup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose a file…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check a file…" })).toBeVisible();
});

test("derives the seeded total, saves an immutable second snapshot, and persists after reload", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);

  await page.getByRole("button", { name: /update balances/i }).click();
  const dialog = page.getByRole("dialog", { name: "Update balances" });
  await dialog.getByLabel("Banca Aurora balance").fill("6000");
  await dialog.getByRole("button", { name: "Save Snapshot" }).click();

  await expect(page.locator(".toast")).toContainText("new snapshot was saved");
  await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("10.600,05");
  await expect(page.getByLabel("Wealth change metrics").locator(".wealth-context__item", { hasText: "Last update" })).toContainText("+1.179,65");
  await expect(page.locator(".history-panel .recharts-responsive-container")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("10.600,05");

  const backup = JSON.parse(await readDownload(await exportBackup(page)));
  expect(backup.snapshots).toHaveLength(2);
  expect(backup.snapshots.find((snapshot: { id: string }) => snapshot.id === "initial-snapshot")?.totalWealth).toBe(9420.4);
  expect(backup.snapshots.map((snapshot: { totalWealth: number }) => snapshot.totalWealth).sort()).toEqual([10600.05, 9420.4]);
});

test("uses the overview numeric typography for goal amounts", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);

  const goalAmount = page.locator(".goal-panel .goal-content__numbers .money").first();
  const overviewAmount = page.locator(".category-summary .money").first();
  const [goalTypography, overviewTypography] = await Promise.all([
    goalAmount.evaluate((element) => ({
      fontFamily: getComputedStyle(element).fontFamily,
      fontWeight: getComputedStyle(element).fontWeight,
    })),
    overviewAmount.evaluate((element) => ({
      fontFamily: getComputedStyle(element).fontFamily,
      fontWeight: getComputedStyle(element).fontWeight,
    })),
  ]);

  expect(goalTypography).toEqual(overviewTypography);
});

test("keeps Trend typography large enough to read", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  await railButton(page, "Trend").click();

  const minimumSizes: Array<[string, number]> = [
    [".progress-view .eyebrow", 11],
    [".trend-summary__label", 13],
    [".trend-summary__detail", 12],
    [".history-readiness__item strong", 13],
    [".history-readiness__item small", 12],
    [".history-readiness__status", 11],
    [".trend-panel h2", 18],
    [".trend-integrity p", 14],
    [".milestone-next__amount", 20],
    [".milestone-track__amount", 14],
    [".milestone-track__status", 11],
    [".trend-review__empty", 14],
  ];

  for (const [selector, minimumSize] of minimumSizes) {
    const fontSize = await page.locator(selector).first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize, selector).toBeGreaterThanOrEqual(minimumSize);
  }
});

test("renders discrete wealth snapshots with unambiguous axes and a card-style tooltip", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);

  const backup = JSON.parse(await readDownload(await exportBackup(page)));
  const initialSnapshot = backup.snapshots[0];
  const largestIncludedBalance = initialSnapshot.accountBalances
    .filter((balance: { includedInWealth: boolean }) => balance.includedInWealth)
    .reduce((largest: { balance: number }, balance: { balance: number }) => balance.balance > largest.balance ? balance : largest);
  const observations = [
    ["aug-25", "2026-08-25T10:00:00+02:00", 8000],
    ["aug-26", "2026-08-26T10:00:00+02:00", 8500],
    ["aug-27", "2026-08-27T10:00:00+02:00", 9000],
    ["aug-28-early", "2026-08-28T14:10:00+02:00", 9300],
    ["aug-28-late", "2026-08-28T18:23:00+02:00", 9420.4],
  ] as const;

  backup.exportedAt = "2026-08-28T18:30:00+02:00";
  backup.accounts = backup.accounts.map((account: Record<string, unknown>) => ({
    ...account,
    createdAt: "2026-08-24T10:00:00+02:00",
    lastUpdated: "2026-08-28T18:23:00+02:00",
  }));
  backup.snapshots = observations.map(([id, createdAt, totalWealth]) => ({
    id,
    createdAt,
    totalWealth,
    accountBalances: initialSnapshot.accountBalances.map((balance: { accountId: string; balance: number; includedInWealth: boolean }) => ({
      ...balance,
      balance: balance.accountId === largestIncludedBalance.accountId
        ? balance.balance + totalWealth - initialSnapshot.totalWealth
        : balance.balance,
    })),
  }));

  await page.getByLabel("Choose JSON backup to import").setInputFiles({
    name: "wealth-history-visual-check.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole("alertdialog", { name: "Import this backup?" })
    .getByRole("button", { name: "Replace local data" })
    .click();

  await expect(page.locator(".toast")).toContainText("Backup imported");
  const historyPanel = page.locator(".history-panel");
  await expect(historyPanel.locator(".recharts-area-dot")).toHaveCount(5);
  await expect(historyPanel.getByText("28 Aug, 14:10", { exact: true })).toBeVisible();
  const lastTick = historyPanel.getByText("28 Aug, 18:23", { exact: true });
  await expect(lastTick).toBeVisible();
  const panelBounds = await historyPanel.boundingBox();
  const lastTickBounds = await lastTick.boundingBox();
  const halfThousandTickBounds = await historyPanel.getByText("2.5k", { exact: true }).boundingBox();
  expect(lastTickBounds && panelBounds && lastTickBounds.x + lastTickBounds.width <= panelBounds.x + panelBounds.width).toBe(true);
  expect(halfThousandTickBounds && panelBounds && halfThousandTickBounds.x >= panelBounds.x).toBe(true);
  // One period dropdown: its trigger shows the period, useless periods are disabled options.
  const period = historyPanel.getByRole("combobox", { name: "Trend period" });
  await expect(period).toHaveValue("ALL");
  await expect(period.locator('option[value="1M"]')).toBeDisabled();
  await expect(period.locator('option[value="1Y"]')).toBeDisabled();
  await expect(period.locator('option[value="ALL"]')).toBeEnabled();

  await page.waitForTimeout(600);
  await historyPanel.locator(".recharts-area-dot").last().hover();
  await expect(historyPanel.locator(".chart-tooltip")).toBeVisible();
  const tooltipStyle = await historyPanel.locator(".chart-tooltip").evaluate((element) => ({
    borderRadius: getComputedStyle(element).borderRadius,
    boxShadow: getComputedStyle(element).boxShadow,
  }));
  expect(tooltipStyle.borderRadius).toBe("18px");
  expect(tooltipStyle.boxShadow).not.toBe("none");

  await topBar(page).getByRole("button", { name: "Switch to Italian", exact: true }).click();
  await expect(historyPanel.getByRole("heading", { name: "Andamento del patrimonio" })).toBeVisible();
  await page.waitForTimeout(600);
  await historyPanel.locator(".recharts-area-dot").last().hover();
  await expect(historyPanel.locator(".chart-tooltip")).toBeVisible();
  await mkdir(screenshotDirectory, { recursive: true });
  await historyPanel.screenshot({ path: path.join(screenshotDirectory, "wealth-history-chart.png") });
});

test("creates, edits, excludes, and deletes an account", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  await railButton(page, "Accounts").click();

  await page.getByRole("button", { name: "Add account" }).click();
  let dialog = page.getByRole("dialog", { name: "Add account" });
  await dialog.getByLabel("Account name").fill("Investment Jar");
  await dialog.getByLabel("Category").selectOption("investments");
  await dialog.getByLabel("Current balance").fill("100");
  await dialog.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByRole("status")).toContainText("Investment Jar was added");

  await page.getByRole("button", { name: "Open Investment Jar details" }).click();
  dialog = page.getByRole("dialog", { name: "Investment Jar" });
  await dialog.getByRole("button", { name: "Edit account" }).click();
  dialog = page.getByRole("dialog", { name: "Edit Investment Jar" });
  await dialog.getByLabel("Account name").fill("Emergency Buffer");
  await dialog.getByLabel("Current balance").fill("125");
  await dialog.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByRole("status")).toContainText("Emergency Buffer was updated");

  const inclusion = page.getByLabel("Include Emergency Buffer in Total Wealth");
  await inclusion.click();
  await expect(inclusion).not.toBeChecked();
  await expect(page.locator(".toast")).toContainText("Emergency Buffer excluded from Total Wealth");
  await railButton(page, "Overview").click();
  await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("9.420,40");

  await railButton(page, "Accounts").click();
  await page.getByRole("button", { name: "Open Emergency Buffer details" }).click();
  await page.getByRole("dialog", { name: "Emergency Buffer" }).getByRole("button", { name: "Delete" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Delete Emergency Buffer?" });
  await confirmation.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByRole("status")).toContainText("Emergency Buffer was archived");
  await expect(page.getByRole("button", { name: "Open Emergency Buffer details" })).toHaveCount(0);
});

test("persists user-defined access and volatility without classifying existing providers", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await page.addInitScript(() => window.localStorage.setItem("wealth-language", "en"));
  await openDashboard(page);
  await railButton(page, "Accounts").click();

  const unclassified = page.getByTestId("access-group-unclassified");
  await expect(unclassified).toContainText("Banca Aurora");
  await expect(unclassified).toContainText("Broker Orione");
  await expect(page.getByTestId("access-group-immediate")).toHaveCount(0);

  await page.getByRole("button", { name: "Open Banca Aurora details" }).click();
  await page.getByRole("dialog", { name: "Banca Aurora" }).getByRole("button", { name: "Edit account" }).click();
  const editor = page.getByRole("dialog", { name: "Edit Banca Aurora" });
  await editor.getByLabel("Access").selectOption("immediate");
  await editor.getByLabel("Volatility").selectOption("stable");
  await editor.getByRole("button", { name: "Save account" }).click();

  const immediate = page.getByTestId("access-group-immediate");
  await expect(immediate).toContainText("Banca Aurora");
  await expect(immediate).toContainText("Liquidity");
  await expect(immediate).toContainText("Stable");

  await page.reload();
  await expect(page.getByTestId("wealth-hero")).toBeVisible();
  await railButton(page, "Accounts").click();
  await expect(page.getByTestId("access-group-immediate")).toContainText("Banca Aurora");

  await page.getByRole("button", { name: "Open Banca Aurora details" }).click();
  await page.getByRole("dialog", { name: "Banca Aurora" }).getByRole("button", { name: "Edit account" }).click();
  const reopenedEditor = page.getByRole("dialog", { name: "Edit Banca Aurora" });
  await reopenedEditor.getByLabel("Access").selectOption("");
  await reopenedEditor.getByLabel("Volatility").selectOption("");
  await reopenedEditor.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByTestId("access-group-unclassified")).toContainText("Banca Aurora");
});

test("keeps the Account Access Profile readable without horizontal overflow on mobile", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => window.localStorage.setItem("wealth-language", "en"));
  await openDashboard(page);
  await railButton(page, "Accounts").click();

  await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  await expect(page.getByTestId("access-summary-unclassified")).toBeVisible();
  await expect(page.getByTestId("access-group-unclassified")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Account Access Profile mobile");
});

test("keeps Cash Counter as the source of truth for Cash", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  await railButton(page, "Accounts").click();
  await page.getByRole("button", { name: "Cash Counter" }).click();

  const dialog = page.getByRole("dialog", { name: "Cash Counter" });
  await dialog.getByLabel("10 euro notes").fill("2");
  await dialog.getByRole("button", { name: "Update Cash" }).click();
  await expect(page.getByRole("status")).toContainText("Cash Counter and Cash balance are now in sync");
  await expect(page.getByTestId("account-cash")).toContainText("190,00");

  await railButton(page, "Overview").click();
  await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("9.430,40");
});

test("supports paycheck CRUD while preserving the two seeded June records", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  await railButton(page, "Cash Flow").click();
  await expect(page.locator(".paycheck-row")).toHaveCount(8);
  await expect(page.locator(".paycheck-row").filter({ hasText: "Jun" })).toHaveCount(2);

  await page.getByRole("button", { name: "Add paycheck" }).click();
  let dialog = page.getByRole("dialog", { name: "Add paycheck" });
  await dialog.getByLabel("Payment date").fill("2026-06-15");
  await dialog.getByLabel("Amount").fill("333.33");
  await dialog.getByLabel(/Label/).fill("Bonus");
  await dialog.getByRole("button", { name: "Save paycheck" }).click();
  await expect(page.locator(".paycheck-row")).toHaveCount(9);

  await page.locator(".paycheck-row").filter({ hasText: "Bonus" }).click();
  dialog = page.getByRole("dialog", { name: "Edit paycheck" });
  await dialog.getByLabel("Amount").fill("444.44");
  await dialog.getByRole("button", { name: "Save paycheck" }).click();
  await expect(page.locator(".paycheck-row").filter({ hasText: "Bonus" })).toContainText("444,44");

  const bonusRow = page.locator(".paycheck-row").filter({ hasText: "Bonus" });
  await bonusRow.click();
  await page.getByRole("dialog", { name: "Edit paycheck" }).getByRole("button", { name: "Delete" }).click();
  let confirmation = page.getByRole("alertdialog", { name: "Delete this paycheck?" });
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(bonusRow).toBeFocused();

  await bonusRow.click();
  await page.getByRole("dialog", { name: "Edit paycheck" }).getByRole("button", { name: "Delete" }).click();
  confirmation = page.getByRole("alertdialog", { name: "Delete this paycheck?" });
  await confirmation.getByRole("button", { name: "Delete paycheck" }).click();
  await expect(page.locator(".paycheck-row")).toHaveCount(8);
  await expect(page.locator(".paycheck-row").filter({ hasText: "Jun" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /update balances/i })).toBeFocused();
});

test("updates the wealth goal from persisted Total Wealth", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  await page.getByRole("button", { name: "Edit wealth goal" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit wealth goal" });
  await dialog.getByLabel("Goal name").fill("Emergency reserve");
  await dialog.getByLabel("Target amount").fill("20000");
  await dialog.getByRole("button", { name: "Save goal" }).click();

  await expect(page.getByRole("heading", { name: "Emergency reserve" })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAccessibleName("47,10% of goal reached");
  await expect(page.getByText("47,10% complete")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Emergency reserve" })).toBeVisible();
});

test("exports valid JSON and rejects an invalid import without mutating data", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);

  const download = await exportBackup(page);
  expect(download.suggestedFilename()).toMatch(/^wealth-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(await readDownload(download));
  expect(backup.version).toBe(2);
  expect(backup.accounts).toHaveLength(7);
  expect(backup.paychecks).toHaveLength(8);
  expect(backup.cashDenominations).toHaveLength(7);

  await page.getByLabel("Choose JSON backup to import").setInputFiles({
    name: "invalid-wealth-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":1,"accounts":[]}'),
  });
  await expect(page.locator(".toast")).toContainText("Import rejected");
  await expect(page.getByRole("alertdialog", { name: "Import this backup?" })).toHaveCount(0);
  await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("9.420,40");
});

test("confirms a valid version 2 import and renders a zero-baseline percentage honestly", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  const backup = {
    version: 2,
    exportedAt: "2026-08-26T10:00:00.000Z",
    accounts: [
      {
        id: "cash",
        name: "Cash",
        category: "liquidity",
        currency: "EUR",
        balance: 0,
        includedInWealth: true,
        createdAt: "2026-08-25T08:00:00.000Z",
        lastUpdated: "2026-08-26T10:00:00.000Z",
      },
      {
        id: "new-savings",
        name: "New savings",
        category: "liquidity",
        currency: "EUR",
        balance: 250,
        includedInWealth: true,
        createdAt: "2026-08-26T09:00:00.000Z",
        lastUpdated: "2026-08-26T10:00:00.000Z",
      },
    ],
    cashDenominations: [5, 10, 20, 50, 100, 200, 500].map((denomination) => ({ denomination, quantity: 0 })),
    snapshots: [
      {
        id: "zero-baseline",
        createdAt: "2026-08-25T12:00:00.000Z",
        totalWealth: 0,
        accountBalances: [{ accountId: "cash", balance: 0, includedInWealth: true }],
      },
      {
        id: "first-growth",
        createdAt: "2026-08-26T10:00:00.000Z",
        totalWealth: 250,
        accountBalances: [
          { accountId: "cash", balance: 0, includedInWealth: true },
          { accountId: "new-savings", balance: 250, includedInWealth: true },
        ],
      },
    ],
    paychecks: [],
    goals: [],
  };

  await page.getByLabel("Choose JSON backup to import").setInputFiles({
    name: "valid-v2-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  const confirmation = page.getByRole("alertdialog", { name: "Import this backup?" });
  await confirmation.getByRole("button", { name: "Replace local data" }).click();

  await expect(page.locator(".toast")).toContainText("Backup imported");
  await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("250,00");
  const previousSnapshot = page.getByLabel("Wealth change metrics").locator(".wealth-context__item", { hasText: "Last update" });
  await expect(previousSnapshot).toContainText("+250,00");
  await expect(previousSnapshot).toContainText("—");
  await expect(previousSnapshot).not.toContainText("0,00%");
});

test("keeps dialogs keyboard accessible and restores focus to their triggers", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  const updateButton = page.getByRole("button", { name: /update balances/i });
  await updateButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Update balances" });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(updateButton).toBeFocused();

  const goalButton = page.getByRole("button", { name: "Edit wealth goal" });
  await goalButton.focus();
  await page.keyboard.press("Enter");
  const goalDialog = page.getByRole("dialog", { name: "Edit wealth goal" });
  await expect(goalDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(goalDialog).toHaveCount(0);
  await expect(goalButton).toBeFocused();
});

test("restores stable focus across account dialog transitions and confirmation outcomes", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  await railButton(page, "Accounts").click();
  const accountTrigger = page.getByRole("button", { name: "Open Conto Vela details" });

  await accountTrigger.click();
  await page.getByRole("dialog", { name: "Conto Vela" }).getByRole("button", { name: "Edit account" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit Conto Vela" });
  await editDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(editDialog).toHaveCount(0);
  await expect(accountTrigger).toBeFocused();

  await accountTrigger.click();
  await page.getByRole("dialog", { name: "Conto Vela" }).getByRole("button", { name: "Delete" }).click();
  let confirmation = page.getByRole("alertdialog", { name: "Delete Conto Vela?" });
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(accountTrigger).toBeFocused();

  await accountTrigger.click();
  await page.getByRole("dialog", { name: "Conto Vela" }).getByRole("button", { name: "Delete" }).click();
  confirmation = page.getByRole("alertdialog", { name: "Delete Conto Vela?" });
  await confirmation.getByRole("button", { name: "Delete account" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(accountTrigger).toHaveCount(0);
  await expect(page.getByRole("button", { name: /update balances/i })).toBeFocused();
});

test("keeps the desktop shell and sidebar at every supported desktop width", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  await mkdir(screenshotDirectory, { recursive: true });
  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "compact-desktop", width: 900, height: 900 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.getByTestId("wealth-hero")).toBeVisible();
    const sidebar = page.locator(".sidebar");
    const sidebarBox = await sidebar.boundingBox();
    await expect(page.locator(".brand")).toBeVisible();
    expect(sidebarBox?.y).toBe(0);
    expect(sidebarBox?.height).toBe(viewport.height);
    expect(sidebarBox?.width ?? 0).toBeGreaterThan(150);
    if (viewport.width === 1440) await expectNoHorizontalOverflow(page, viewport.name);
    await page.screenshot({
      path: path.join(screenshotDirectory, `dashboard-${viewport.width}x${viewport.height}.png`),
      animations: "disabled",
    });
  }
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("wealth-language", "en"));
});

test("verifies Decision Simulator comparison, privacy, reset, isolation, and responsive evidence", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  await mkdir(screenshotDirectory, { recursive: true });

  const primaryLabels = await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button")
    .allTextContents();
  expect(primaryLabels).toEqual(["Overview", "Accounts", "Cash Flow", "Trend", "Goals", "Projections"]);

  for (const viewport of [{ name: "desktop", width: 1440, height: 900 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.getByTestId("wealth-hero")).toBeVisible();

    await railButton(page, "Trend").click();
    await expect(page.getByRole("heading", { name: "Trend", exact: true })).toBeVisible();
    const basisLegend = page.getByRole("group", { name: "Data basis legend" });
    await expect(basisLegend.getByText("Observed", { exact: true })).toBeVisible();
    await expect(basisLegend.getByText("Derived", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Wealth milestones" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Monthly wealth review" })).toBeVisible();
    await expect(page.getByRole("region", { name: "History in progress" })).toBeVisible();
    await expectNoHorizontalOverflow(page, `${viewport.name} Progress cockpit`);

    const progressProfile = topBar(page);
    await progressProfile.getByRole("button", { name: "Hide amounts" }).click();
    await expect(page.getByTestId("progress-current-wealth")).not.toContainText("9.420,40");
    await progressProfile.getByRole("button", { name: "Show amounts" }).click();
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: path.join(screenshotDirectory, `decision-progress-${viewport.width}x${viewport.height}.png`),
      animations: "disabled",
      fullPage: true,
    });

    await railButton(page, "Projections").click();
    await expect(page.getByRole("heading", { name: "Projections", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /A holiday/ }).click();
    await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("1500");
    await page.getByLabel("Today's monthly saving").fill("500");
    await expect(page.getByRole("heading", { name: "Your goal moves 3 months later." })).toBeVisible();
    await expect(page.getByTestId("afford-year-with")).toContainText("13.920,40");
    const chart = page.getByRole("region", { name: "Without and with this choice" });
    await expect(chart.getByText("Without this choice")).toBeVisible();
    await expect(chart.getByText("With this choice")).toBeVisible();
    await expectNoHorizontalOverflow(page, `${viewport.name} Projections`);

    const simulatorProfile = topBar(page);
    await simulatorProfile.getByRole("button", { name: "Hide amounts" }).click();
    await expect(page.getByTestId("afford-year-with")).not.toContainText("13.920,40");
    await simulatorProfile.getByRole("button", { name: "Show amounts" }).click();
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: path.join(screenshotDirectory, `decision-simulator-${viewport.width}x${viewport.height}.png`),
      animations: "disabled",
      fullPage: true,
    });

    const startOver = page.getByRole("button", { name: "Start over" });
    await startOver.focus();
    await expect(startOver).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Today's monthly saving")).toHaveValue("0");

    await railButton(page, "Overview").click();
    await expect(page.getByTestId("wealth-hero").getByRole("heading", { level: 1 })).toContainText("9.420,40");
  }
});

test("keeps every cockpit view free of horizontal overflow on tablet and mobile", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  await mkdir(screenshotDirectory, { recursive: true });

  for (const viewport of [
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.getByTestId("wealth-hero")).toBeVisible();
    await expectNoHorizontalOverflow(page, `${viewport.name} Overview`);

    for (const [section, heading] of [["Accounts", "Accounts"], ["Cash Flow", "Cash Flow"], ["Trend", "Trend"], ["Goals", "Goals"]]) {
      await page.getByRole("button", { name: section, exact: true }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page, `${viewport.name} ${section}`);
    }

    await railButton(page, "Projections").click();
    await expect(page.getByRole("heading", { name: "Projections", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page, `${viewport.name} Scenario`);

    await railButton(page, "Overview").click();
    await expect(page.getByTestId("wealth-hero")).toBeVisible();
    await page.getByRole("button", { name: "Open Investments detail" }).click();
    await expect(page.getByRole("heading", { name: "Investments", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page, `${viewport.name} Investments`);

    await railButton(page, "Overview").click();
    await expect(page.getByTestId("wealth-hero")).toBeVisible();
    await page.getByRole("button", { name: "Open Trading detail" }).click();
    await expect(page.getByRole("heading", { name: "Trading", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page, `${viewport.name} Trading`);

    await railButton(page, "Overview").click();
    await expect(page.getByTestId("wealth-hero")).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDirectory, `cockpit-overview-${viewport.name}-${viewport.width}x${viewport.height}.png`),
      animations: "disabled",
      fullPage: true,
    });
  }
});

test("switches the complete dashboard to Italian from the top bar, language before privacy", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openDashboard(page);
  await mkdir(screenshotDirectory, { recursive: true });

  const bar = topBar(page);
  const language = bar.getByRole("button", { name: "Switch to Italian", exact: true });
  const languageBox = await language.boundingBox();
  const privacyBox = await bar.getByRole("button", { name: "Hide amounts" }).boundingBox();
  // Language first, then the eye, along the bar.
  expect(languageBox!.x).toBeLessThan(privacyBox!.x);

  await language.click();
  await expect(page.getByRole("navigation", { name: "Navigazione principale" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Nascondi importi" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(page.evaluate(() => window.localStorage.getItem("wealth-language"))).resolves.toBe("it");

  await page.setViewportSize({ width: 1440, height: 900 });
  // Projections is "Posso permettermelo?" (owner, 18 Oct 2026): one choice,
  // one answer, in Italian throughout.
  await railButton(page, "Proiezioni").click();
  await expect(page.getByRole("heading", { name: "Proiezioni", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Una vacanza/ }).click();
  await expect(page.getByLabel("Importo", { exact: true })).toHaveValue("1500");
  await page.getByLabel("Risparmio mensile di oggi", { exact: true }).fill("500");
  await expect(page.getByRole("heading", { name: /slitta di 3 mesi/ })).toBeVisible();
  await expect(page.getByTestId("afford-year-with")).toContainText("13.920,40");
  const chart = page.getByRole("region", { name: "Senza e con questa scelta" });
  await expect(chart.getByText("Senza questa scelta")).toBeVisible();
  await expect(chart.getByText("Con questa scelta")).toBeVisible();

  await expectNoHorizontalOverflow(page, "Italian Decision Simulator desktop");
  await page.screenshot({
    path: path.join(screenshotDirectory, "decision-simulator-it-1440x900.png"),
    animations: "disabled",
    fullPage: true,
  });
});

test("captures the complete Italian desktop project", async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  const projectDirectory = path.join(screenshotDirectory, "desktop-project");
  await mkdir(projectDirectory, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => window.localStorage.removeItem("wealth-language"));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Crea il tuo PIN" })).toBeVisible();
  await page.screenshot({ path: path.join(projectDirectory, "00-accesso.png"), animations: "disabled" });
  await page.getByLabel("PIN", { exact: true }).fill("2026");
  await page.getByLabel("Conferma PIN").fill("2026");
  await page.getByRole("button", { name: "Crea PIN e continua" }).click();
  await expect(page.getByTestId("wealth-hero")).toBeVisible();
  await loadExampleArchive(page);

  const captureView = async (fileName: string, navigationName: string, headingName: string) => {
    await railButton(page, navigationName).click();
    await expect(page.getByRole("heading", { name: headingName, exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page, headingName);
    await page.waitForTimeout(1_700);
    await page.screenshot({ path: path.join(projectDirectory, fileName), animations: "disabled", fullPage: true });
  };

  await page.waitForTimeout(1_700);
  await expect(page.locator(".allocation-chart .recharts-sector")).toHaveCount(3);
  await page.screenshot({ path: path.join(projectDirectory, "01-panoramica.png"), animations: "disabled", fullPage: true });
  await captureView("02-andamento.png", "Andamento", "Andamento");
  await captureView("03-conti.png", "Conti", "Conti");
  await captureView("04-flussi-di-cassa.png", "Flussi di cassa", "Flussi di cassa");
  await captureView("05-obiettivi.png", "Obiettivi", "Obiettivi");
  await captureView("06-proiezioni.png", "Proiezioni", "Proiezioni");

  await railButton(page, "Panoramica").click();
  await page.getByRole("button", { name: "Apri dettaglio Investimenti" }).click();
  await expect(page.getByRole("heading", { name: "Investimenti", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(projectDirectory, "07-investimenti.png"), animations: "disabled", fullPage: true });
  await railButton(page, "Panoramica").click();
  await page.getByRole("button", { name: "Apri dettaglio Trading" }).click();
  await expect(page.getByRole("heading", { name: "Trading", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(projectDirectory, "08-trading.png"), animations: "disabled", fullPage: true });

  await page.getByRole("button", { name: "Aggiorna saldi", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Aggiorna saldi" })).toBeVisible();
  await page.screenshot({ path: path.join(projectDirectory, "09-aggiorna-saldi.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await railButton(page, "Conti").click();
  await page.getByRole("button", { name: "Conta contanti", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Conteggio contanti" })).toBeVisible();
  await page.screenshot({ path: path.join(projectDirectory, "10-conteggio-contanti.png"), animations: "disabled" });
});
