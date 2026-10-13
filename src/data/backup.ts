import { isoDateTimeSchema, parseWealthBackup, validateWealthBackup } from "@/domain/schemas";
import type { WealthBackup } from "@/domain/types";

import { recordBackupFingerprint } from "./backup-health";
import { wealthDb } from "./db";

/** The backup file format written by createBackup and accepted on import. */
export const backupFormatVersion = 2;

/*
 * When a backup was last written from this device. Device state, like the
 * page visits beside it: it lives in the metadata table, never inside a
 * backup, and an import leaves it alone — the date answers "when did I last
 * export?", which a restored file could not know.
 * It is recorded by whoever actually hands the file to the user, not by
 * createBackup, which only builds the JSON and may be called for other ends.
 */
const lastExportKey = "last-backup-export";

export async function recordBackupExport(exportedAt: string = new Date().toISOString()): Promise<void> {
  await wealthDb.metadata.put({ key: lastExportKey, value: exportedAt });
  // And what it holds, so a later change is known to be missing from it.
  await recordBackupFingerprint();
}

/** The last export's timestamp, or null where none was ever recorded. */
export async function getLastBackupExport(): Promise<string | null> {
  const record = await wealthDb.metadata.get(lastExportKey);
  return typeof record?.value === "string" && isoDateTimeSchema.safeParse(record.value).success ? record.value : null;
}

export async function createBackup(exportedAt: string = new Date().toISOString()): Promise<string> {
  if (!isoDateTimeSchema.safeParse(exportedAt).success) {
    throw new Error("Export timestamp must be a valid ISO date-time with offset");
  }

  const backup = await wealthDb.transaction(
    "r",
    wealthDb.accounts,
    wealthDb.cashDenominations,
    wealthDb.snapshots,
    wealthDb.paychecks,
    wealthDb.goals,
    async (): Promise<WealthBackup> => ({
      version: backupFormatVersion,
      exportedAt,
      accounts: await wealthDb.accounts.toArray(),
      cashDenominations: await wealthDb.cashDenominations.toArray(),
      snapshots: await wealthDb.snapshots.toArray(),
      paychecks: await wealthDb.paychecks.toArray(),
      goals: await wealthDb.goals.toArray(),
    }),
  );

  return JSON.stringify(validateWealthBackup(backup));
}

export async function replaceDatabaseFromBackup(serializedBackup: string): Promise<void> {
  const backup = parseWealthBackup(serializedBackup);

  await wealthDb.transaction(
    "rw",
    [
      wealthDb.accounts,
      wealthDb.cashDenominations,
      wealthDb.snapshots,
      wealthDb.paychecks,
      wealthDb.goals,
      wealthDb.metadata,
    ],
    async () => {
      await Promise.all([
        wealthDb.accounts.clear(),
        wealthDb.cashDenominations.clear(),
        wealthDb.snapshots.clear(),
        wealthDb.paychecks.clear(),
        wealthDb.goals.clear(),
      ]);
      await wealthDb.accounts.bulkAdd(backup.accounts);
      await wealthDb.cashDenominations.bulkAdd(backup.cashDenominations);
      await wealthDb.snapshots.bulkAdd(backup.snapshots);
      await wealthDb.paychecks.bulkAdd(backup.paychecks);
      await wealthDb.goals.bulkAdd(backup.goals);
      await wealthDb.metadata.put({ key: "initialized", value: true });
      // The imported archive is the owner's, never the example one.
      await wealthDb.metadata.delete("demo-data");
    },
  );
  // What was just restored is a file the owner holds: it is backed up as it is.
  await recordBackupFingerprint();
}
