import Dexie, { type Table } from "dexie";

import { upgradeLegacyRecords, type LegacyAccount, type LegacyWealthSnapshot } from "@/domain/legacy";
import type { PinCredentials } from "@/domain/pin";
import { validateWealthBackup } from "@/domain/schemas";
import type { Account, CashDenomination, Paycheck, WealthGoal, WealthSnapshot } from "@/domain/types";

import type { PageVisits } from "./page-visits";

export interface DatabaseMetadata {
  key: string;
  // Device state only, never financial records: flags, the PIN credentials,
  // the security policy, page visits, the last export's timestamp. The
  // table's schema is unchanged; only its values grew.
  value: boolean | string | PinCredentials | { idleTimeoutMs: number } | PageVisits;
}

class WealthDatabase extends Dexie {
  accounts!: Table<Account, string>;
  cashDenominations!: Table<CashDenomination, number>;
  snapshots!: Table<WealthSnapshot, string>;
  paychecks!: Table<Paycheck, string>;
  goals!: Table<WealthGoal, string>;
  metadata!: Table<DatabaseMetadata, string>;

  constructor() {
    super("personal-wealth-dashboard");

    this.version(1).stores({
      accounts: "id, category, includedInWealth, archivedAt",
      cashDenominations: "denomination",
      snapshots: "id, createdAt",
      paychecks: "id, paymentDate",
      goals: "id",
      metadata: "key",
    });

    this.version(2).stores({
      accounts: "id, category, includedInWealth, archivedAt, createdAt",
      cashDenominations: "denomination",
      snapshots: "id, createdAt",
      paychecks: "id, paymentDate",
      goals: "id",
      metadata: "key",
    }).upgrade(async (transaction) => {
      const accountsTable = transaction.table<LegacyAccount, string>("accounts");
      const snapshotsTable = transaction.table<LegacyWealthSnapshot, string>("snapshots");
      const cashDenominationsTable = transaction.table<CashDenomination, number>("cashDenominations");
      const paychecksTable = transaction.table<Paycheck, string>("paychecks");
      const goalsTable = transaction.table<WealthGoal, string>("goals");
      const upgraded = upgradeLegacyRecords(
        await accountsTable.toArray(),
        await snapshotsTable.toArray(),
      );
      validateWealthBackup({
        version: 2,
        exportedAt: "1970-01-01T00:00:00.000Z",
        accounts: upgraded.accounts,
        cashDenominations: await cashDenominationsTable.toArray(),
        snapshots: upgraded.snapshots,
        paychecks: await paychecksTable.toArray(),
        goals: await goalsTable.toArray(),
      });
      await accountsTable.bulkPut(upgraded.accounts);
      await snapshotsTable.bulkPut(upgraded.snapshots);
    });
  }
}

export const wealthDb = new WealthDatabase();
