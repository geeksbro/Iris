import { wealthDb } from "./db";

/*
 * How many times each main page has been entered on this device. It is
 * device state, like the security policy: it lives in the metadata table,
 * never in a backup (which carries financial records only), and an import
 * leaves it as it was. Nothing here leaves the browser.
 *
 * The pages are the rail's six views, under the dashboard's own view ids.
 * One record holds all six counts; a page never entered reads as 0, and a
 * count that is missing or damaged reads as 0 rather than being trusted.
 */

const pageVisitsKey = "page-visits";

export const trackedPages = ["overview", "accounts", "cash-flow", "progress", "goals", "scenario"] as const;
export type TrackedPage = (typeof trackedPages)[number];
export type PageVisits = Record<TrackedPage, number>;

export function isTrackedPage(value: string): value is TrackedPage {
  return (trackedPages as readonly string[]).includes(value);
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readPageVisits(stored: unknown): PageVisits {
  const record = typeof stored === "object" && stored !== null ? stored as Record<string, unknown> : {};
  return Object.fromEntries(trackedPages.map((page) => [page, readCount(record[page])])) as PageVisits;
}

/** Every tracked page with its count, 0 for a page never entered. */
export async function getPageVisits(): Promise<PageVisits> {
  const record = await wealthDb.metadata.get(pageVisitsKey);
  return readPageVisits(record?.value);
}

/**
 * Clears the visit counts and nothing else. It removes the one record that
 * holds them, so every page reads 0 again; accounts, snapshots, paychecks,
 * goals and every preference are in other tables or other keys and are not
 * touched. There is nothing to undo it with, so the caller asks first.
 */
export async function resetPageVisits(): Promise<void> {
  await wealthDb.metadata.delete(pageVisitsKey);
}

/** Counts one entry into a page. Read and write share one transaction, so two tabs never lose a visit. */
export async function recordPageVisit(page: TrackedPage): Promise<void> {
  await wealthDb.transaction("rw", wealthDb.metadata, async () => {
    const visits = await getPageVisits();
    visits[page] += 1;
    await wealthDb.metadata.put({ key: pageVisitsKey, value: visits });
  });
}
