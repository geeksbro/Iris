import type { WealthBackup } from "@/domain/types";

import { wealthDb } from "./db";

/*
 * BACKUP HEALTH. The archive lives in one browser on one device; a backup the
 * owner exports is the only copy that survives the site's data being cleared,
 * the browser evicting it, or the device itself. So the dashboard keeps track
 * of whether the last export still matches what is stored, and asks for one
 * at the moments it matters (backupReminderFor). It never claims the local
 * archive is safe by itself.
 *
 * Everything here is device state in the metadata table — never in a backup,
 * never sent anywhere.
 */

const fingerprintKey = "last-backup-fingerprint";
const exportKey = "last-backup-export";
const demoKey = "demo-data";

type ArchiveTables = Pick<WealthBackup, "accounts" | "cashDenominations" | "snapshots" | "paychecks" | "goals">;

/**
 * What the archive holds, reduced to a short string: equal for equal
 * content. Not a security measure — a way to tell "this backup still
 * matches" from "something changed since". FNV-1a over the canonical JSON.
 */
export function fingerprintOf(tables: ArchiveTables): string {
  const text = JSON.stringify([tables.accounts, tables.cashDenominations, tables.snapshots, tables.paychecks, tables.goals]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}-${text.length}`;
}

async function readTables(): Promise<ArchiveTables> {
  const [accounts, cashDenominations, snapshots, paychecks, goals] = await Promise.all([
    wealthDb.accounts.toArray(),
    wealthDb.cashDenominations.toArray(),
    wealthDb.snapshots.toArray(),
    wealthDb.paychecks.toArray(),
    wealthDb.goals.toArray(),
  ]);
  return { accounts, cashDenominations, snapshots, paychecks, goals };
}

/**
 * Records which content the backup just handed to the owner holds. Read from
 * the store, as the backup was, not from the backup's JSON: validation may
 * reorder an object's keys, and the comparison must be like for like.
 */
export async function recordBackupFingerprint(): Promise<void> {
  await wealthDb.metadata.put({ key: fingerprintKey, value: fingerprintOf(await readTables()) });
}

export type BackupHealth = {
  /** The archive holds something of the owner's: not empty, not the example archive. */
  hasOwnData: boolean;
  lastExportAt: string | null;
  /** The last export matches what is stored now. */
  upToDate: boolean;
  /** Updates saved and accounts added since the last export (all of them if there was none). */
  changesSinceExport: number;
};

export async function getBackupHealth(): Promise<BackupHealth> {
  const [tables, exported, fingerprint, demo] = await Promise.all([
    readTables(),
    wealthDb.metadata.get(exportKey),
    wealthDb.metadata.get(fingerprintKey),
    wealthDb.metadata.get(demoKey),
  ]);
  const lastExportAt = typeof exported?.value === "string" ? exported.value : null;
  const onlyCashAtZero = tables.accounts.every((account) => account.id === "cash" && account.balance === 0);
  const hasOwnData = demo?.value !== true
    && (!onlyCashAtZero || tables.snapshots.length > 0 || tables.paychecks.length > 0 || tables.goals.length > 0);
  const since = lastExportAt ? Date.parse(lastExportAt) : Number.NEGATIVE_INFINITY;
  const changesSinceExport = tables.snapshots.filter((snapshot) => Date.parse(snapshot.createdAt) > since).length
    + tables.accounts.filter((account) => account.id !== "cash" && Date.parse(account.createdAt) > since).length;
  return {
    hasOwnData,
    lastExportAt,
    upToDate: typeof fingerprint?.value === "string" && fingerprint.value === fingerprintOf(tables),
    changesSinceExport,
  };
}

export type BackupReminder =
  | { reason: "first" }
  | { reason: "time"; days: number }
  | { reason: "changes"; changes: number };

/** A backup older than this, with changes since, is worth renewing. */
export const backupStaleDays = 14;
/** This many updates or new accounts since the last backup are worth a new one. */
export const backupChangeThreshold = 3;

/**
 * Whether to ask for a backup now, and why. Never for an archive with
 * nothing of the owner's in it, never when the last backup still matches,
 * never while the owner has put the question off.
 */
export function backupReminderFor(health: BackupHealth, now: Date, snoozedUntil: string | null): BackupReminder | null {
  if (!health.hasOwnData || health.upToDate) return null;
  if (snoozedUntil && Date.parse(snoozedUntil) > now.getTime()) return null;
  if (!health.lastExportAt) return { reason: "first" };
  const days = Math.floor((now.getTime() - Date.parse(health.lastExportAt)) / 86_400_000);
  if (days >= backupStaleDays) return { reason: "time", days };
  if (health.changesSinceExport >= backupChangeThreshold) return { reason: "changes", changes: health.changesSinceExport };
  return null;
}
