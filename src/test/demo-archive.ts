import { demoCreatedAt } from "@/data/demo";
import { canLoadDemoData, initializeDatabase, loadDemoData } from "@/data/repository";

/**
 * The archive most tests start from: a device initialised, then the fictional
 * example archive loaded at its fixed date (data/demo.ts), so every figure a
 * test expects is computed from the same records. Like initializeDatabase,
 * calling it again changes nothing.
 */
export async function initializeWithDemoArchive(): Promise<void> {
  await initializeDatabase();
  if (await canLoadDemoData()) await loadDemoData(demoCreatedAt);
}
