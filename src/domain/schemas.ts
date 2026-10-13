import { z } from "zod";

import {
  calculateCashTotal,
  calculateTotalWealth,
  isSafeCurrencyAmount,
  MAX_CURRENCY_AMOUNT,
  roundCurrency,
} from "./calculations";
import { upgradeLegacyRecords } from "./legacy";
import {
  accountAccessValues,
  accountCategories,
  accountVolatilityValues,
  goalTypes,
  paycheckTypes,
  type WealthBackup,
} from "./types";

const supportedCashDenominations = [5, 10, 20, 50, 100, 200, 500] as const;

const safeNonNegativeAmount = z.number().finite().min(0).max(MAX_CURRENCY_AMOUNT);
const safePositiveAmount = z.number().finite().positive().max(MAX_CURRENCY_AMOUNT);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
const calendarDate = z.string().refine(
  (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return month >= 1 && month <= 12 && day >= 1 && day <= lastDayOfMonth;
  },
  { message: "Expected a real ISO calendar date" },
);

const legacyAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(accountCategories),
  currency: z.literal("EUR"),
  balance: safeNonNegativeAmount,
  includedInWealth: z.boolean(),
  access: z.enum(accountAccessValues).optional(),
  volatility: z.enum(accountVolatilityValues).optional(),
  lastUpdated: isoDateTimeSchema,
  icon: z.string().min(1).optional(),
  archivedAt: isoDateTimeSchema.optional(),
}).strict();

const accountSchema = legacyAccountSchema.extend({
  createdAt: isoDateTimeSchema,
}).superRefine((account, context) => {
  const createdAt = new Date(account.createdAt).getTime();
  if (new Date(account.lastUpdated).getTime() < createdAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lastUpdated"],
      message: "Account lastUpdated cannot precede createdAt",
    });
  }
  if (account.archivedAt && new Date(account.archivedAt).getTime() < createdAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["archivedAt"],
      message: "Account archivedAt cannot precede createdAt",
    });
  }
});

const legacySnapshotAccountBalanceSchema = z.object({
  accountId: z.string().min(1),
  balance: safeNonNegativeAmount,
}).strict();

const snapshotAccountBalanceSchema = legacySnapshotAccountBalanceSchema.extend({
  includedInWealth: z.boolean(),
});

type IdentifierRecord = Record<string, unknown>;

function addDuplicateIdentifierIssues(
  records: IdentifierRecord[],
  key: string,
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string | number>();
  records.forEach((record, index) => {
    const value = record[key];
    if (typeof value !== "string" && typeof value !== "number") return;
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, key],
        message: `Duplicate ${key}`,
      });
      return;
    }
    seen.add(value);
  });
}

const legacySnapshotSchema = z.object({
  id: z.string().min(1),
  createdAt: isoDateTimeSchema,
  totalWealth: safeNonNegativeAmount,
  accountBalances: z.array(legacySnapshotAccountBalanceSchema),
}).strict().superRefine((snapshot, context) => {
  addDuplicateIdentifierIssues(snapshot.accountBalances, "accountId", ["accountBalances"], context);
});

const snapshotSchema = z.object({
  id: z.string().min(1),
  createdAt: isoDateTimeSchema,
  totalWealth: safeNonNegativeAmount,
  accountBalances: z.array(snapshotAccountBalanceSchema),
}).strict().superRefine((snapshot, context) => {
  addDuplicateIdentifierIssues(snapshot.accountBalances, "accountId", ["accountBalances"], context);
});

const cashDenominationSchema = z.object({
  denomination: z.number().finite().positive().max(500),
  quantity: z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();

const paycheckSchema = z.object({
  id: z.string().min(1),
  paymentDate: calendarDate,
  amount: safeNonNegativeAmount,
  type: z.enum(paycheckTypes).optional(),
  label: z.string().optional(),
  competencePeriod: z.string().optional(),
  notes: z.string().optional(),
}).strict();

const wealthGoalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(goalTypes).optional(),
  targetAmount: safePositiveAmount,
  targetDate: calendarDate.optional(),
}).strict();

const persistentDomains = {
  exportedAt: isoDateTimeSchema,
  cashDenominations: z.array(cashDenominationSchema),
  paychecks: z.array(paycheckSchema),
  goals: z.array(wealthGoalSchema),
};

const legacyWealthBackupSchema = z.object({
  version: z.literal(1),
  ...persistentDomains,
  accounts: z.array(legacyAccountSchema),
  snapshots: z.array(legacySnapshotSchema),
}).strict();

export const wealthBackupSchema = z.object({
  version: z.literal(2),
  ...persistentDomains,
  accounts: z.array(accountSchema),
  snapshots: z.array(snapshotSchema),
}).strict().superRefine((backup, context) => {
  addDuplicateIdentifierIssues(backup.accounts, "id", ["accounts"], context);
  addDuplicateIdentifierIssues(backup.cashDenominations, "denomination", ["cashDenominations"], context);
  addDuplicateIdentifierIssues(backup.snapshots, "id", ["snapshots"], context);
  addDuplicateIdentifierIssues(backup.paychecks, "id", ["paychecks"], context);
  addDuplicateIdentifierIssues(backup.goals, "id", ["goals"], context);

  const capturedAt = new Set<number>();
  backup.snapshots.forEach((snapshot, index) => {
    const timestamp = new Date(snapshot.createdAt).getTime();
    if (capturedAt.has(timestamp)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshots", index, "createdAt"],
        message: "Duplicate snapshot capture timestamp",
      });
    } else {
      capturedAt.add(timestamp);
    }
  });

  const cashDenominationValues = new Set(backup.cashDenominations.map((item) => item.denomination));
  if (
    backup.cashDenominations.length !== supportedCashDenominations.length ||
    supportedCashDenominations.some((denomination) => !cashDenominationValues.has(denomination))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cashDenominations"],
      message: "Cash Counter must contain exactly the supported EUR denominations",
    });
  }

  const cashCounterTotal = calculateCashTotal(backup.cashDenominations);
  if (!isSafeCurrencyAmount(cashCounterTotal)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cashDenominations"],
      message: "Cash Counter total must be a safe finite currency amount",
    });
  }

  const currentTotalWealth = calculateTotalWealth(
    backup.accounts.filter((account) => !account.archivedAt),
  );
  if (!isSafeCurrencyAmount(currentTotalWealth)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accounts"],
      message: "Current Total Wealth exceeds the safe currency limit",
    });
  }

  const cashAccounts = backup.accounts.filter((account) => account.id === "cash");
  const activeCash = cashAccounts.filter((account) => !account.archivedAt);
  if (cashAccounts.length !== 1 || activeCash.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accounts"],
      message: "Backup must contain exactly one active reserved Cash account",
    });
  } else {
    const cash = activeCash[0];
    const cashIndex = backup.accounts.indexOf(cash);
    if (cash.name !== "Cash" || cash.category !== "liquidity" || cash.currency !== "EUR") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accounts", cashIndex],
        message: "Reserved Cash account identity is invalid",
      });
    }
    if (isSafeCurrencyAmount(cashCounterTotal) && cash.balance !== cashCounterTotal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accounts", cashIndex, "balance"],
        message: "Active Cash account balance must equal the Cash Counter total",
      });
    }
  }

  const accountById = new Map(backup.accounts.map((account) => [account.id, account]));
  backup.snapshots.forEach((snapshot, snapshotIndex) => {
    const snapshotTime = new Date(snapshot.createdAt).getTime();
    const capturedIds = new Set(snapshot.accountBalances.map((balance) => balance.accountId));

    snapshot.accountBalances.forEach((balance, balanceIndex) => {
      if (!accountById.has(balance.accountId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["snapshots", snapshotIndex, "accountBalances", balanceIndex, "accountId"],
          message: "Snapshot account reference does not exist in accounts",
        });
      }
    });

    const expectedIds = backup.accounts
      .filter((account) => {
        const createdAt = new Date(account.createdAt).getTime();
        const archivedAt = account.archivedAt ? new Date(account.archivedAt).getTime() : null;
        return createdAt <= snapshotTime && (archivedAt === null || archivedAt > snapshotTime);
      })
      .map((account) => account.id);
    if (
      expectedIds.length !== capturedIds.size ||
      expectedIds.some((accountId) => !capturedIds.has(accountId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshots", snapshotIndex, "accountBalances"],
        message: "Snapshot must contain the complete set of accounts active at capture time",
      });
    }

    const includedTotal = roundCurrency(snapshot.accountBalances.reduce(
      (sum, balance) => sum + (balance.includedInWealth ? balance.balance : 0),
      0,
    ));
    if (!isSafeCurrencyAmount(includedTotal)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshots", snapshotIndex, "totalWealth"],
        message: "Snapshot included balances overflow a safe currency total",
      });
    } else if (snapshot.totalWealth !== includedTotal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshots", snapshotIndex, "totalWealth"],
        message: "Snapshot totalWealth must equal its included captured balances",
      });
    }
  });
});

export function validateWealthBackup(backup: unknown): WealthBackup {
  return wealthBackupSchema.parse(backup) as WealthBackup;
}

export function parseWealthBackup(serializedBackup: string): WealthBackup {
  const parsed: unknown = JSON.parse(serializedBackup);
  if (typeof parsed === "object" && parsed !== null && "version" in parsed && parsed.version === 1) {
    const legacy = legacyWealthBackupSchema.parse(parsed);
    const upgraded = upgradeLegacyRecords(legacy.accounts, legacy.snapshots);
    return validateWealthBackup({
      ...legacy,
      version: 2,
      accounts: upgraded.accounts,
      snapshots: upgraded.snapshots,
    });
  }
  return validateWealthBackup(parsed);
}
