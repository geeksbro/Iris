import { wealthDb } from "./db";

/*
 * PERSISTENT STORAGE. Unless the browser has granted persistence, it may
 * clear this site's IndexedDB when the device runs low on space — the whole
 * archive with it. Persistence is asked for once, by itself, the first time
 * the archive holds something of the owner's (BackupGuard); the owner can
 * ask again from Settings › Data. Browsers decide on their own terms: Chrome
 * grants or refuses silently from how the site is used, Firefox asks the
 * person. A refusal is recorded and said plainly; it is never retried in a
 * loop. Even granted, persistence only stops eviction: clearing the site's
 * data, a browser reset or a lost device still lose the archive, which is
 * why the backup reminders exist.
 */

const requestKey = "storage-persist-request";

export type PersistOutcome = "granted" | "denied" | "unsupported";

export type PersistRequest = { outcome: PersistOutcome; at: string };

function isOutcome(value: unknown): value is PersistOutcome {
  return value === "granted" || value === "denied" || value === "unsupported";
}

/** Whether this origin's storage is persistent now; null where the browser does not say. */
export async function isStoragePersisted(): Promise<boolean | null> {
  try {
    return typeof navigator !== "undefined" && navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}

/** Asks the browser for persistent storage and records how it answered. */
export async function requestPersistentStorage(at: string = new Date().toISOString()): Promise<PersistOutcome> {
  let outcome: PersistOutcome;
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) {
      outcome = "unsupported";
    } else if (navigator.storage.persisted && (await navigator.storage.persisted())) {
      outcome = "granted";
    } else {
      outcome = (await navigator.storage.persist()) ? "granted" : "denied";
    }
  } catch {
    outcome = "denied";
  }
  await wealthDb.metadata.put({ key: requestKey, value: JSON.stringify({ outcome, at }) });
  return outcome;
}

/** The last request and its answer, or null if persistence was never asked for on this device. */
export async function getPersistRequest(): Promise<PersistRequest | null> {
  const record = await wealthDb.metadata.get(requestKey);
  if (typeof record?.value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(record.value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { outcome, at } = parsed as Record<string, unknown>;
    return isOutcome(outcome) && typeof at === "string" ? { outcome, at } : null;
  } catch {
    return null;
  }
}
