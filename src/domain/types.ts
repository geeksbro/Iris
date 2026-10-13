export const accountCategories = ["liquidity", "investments", "trading"] as const;

export type AccountCategory = (typeof accountCategories)[number];

export const accountAccessValues = ["immediate", "days", "locked"] as const;
export type AccountAccess = (typeof accountAccessValues)[number];

export const accountVolatilityValues = ["stable", "moderate", "volatile"] as const;
export type AccountVolatility = (typeof accountVolatilityValues)[number];

export interface Account {
  id: string;
  name: string;
  category: AccountCategory;
  currency: "EUR";
  balance: number;
  includedInWealth: boolean;
  access?: AccountAccess;
  volatility?: AccountVolatility;
  createdAt: string;
  lastUpdated: string;
  icon?: string;
  archivedAt?: string;
}

export interface SnapshotAccountBalance {
  accountId: string;
  balance: number;
  includedInWealth: boolean;
}

export interface WealthSnapshot {
  id: string;
  createdAt: string;
  totalWealth: number;
  accountBalances: SnapshotAccountBalance[];
}

export interface CashDenomination {
  denomination: number;
  quantity: number;
}

/*
 * What kind of income a payment is (owner, 26 Sep 2026). Optional: a record
 * saved before the field existed has none and reads as a salary, which is
 * what every record was until then (see paycheckTypeOf).
 */
export const paycheckTypes = ["salary", "extra-month", "bonus", "freelance", "other"] as const;
export type PaycheckType = (typeof paycheckTypes)[number];

export interface Paycheck {
  id: string;
  paymentDate: string;
  amount: number;
  type?: PaycheckType;
  label?: string;
  competencePeriod?: string;
  notes?: string;
}

export const goalTypes = ["total-wealth", "liquidity"] as const;
export type WealthGoalType = (typeof goalTypes)[number];

export interface WealthGoal {
  id: string;
  name: string;
  type?: WealthGoalType;
  targetAmount: number;
  targetDate?: string;
}

export interface WealthBackup {
  version: 2;
  exportedAt: string;
  accounts: Account[];
  cashDenominations: CashDenomination[];
  snapshots: WealthSnapshot[];
  paychecks: Paycheck[];
  goals: WealthGoal[];
}
