import { calculateTotalWealth } from "@/domain/calculations";
import type { Account, CashDenomination, Paycheck, WealthGoal, WealthSnapshot } from "@/domain/types";

/*
 * THE EXAMPLE ARCHIVE. Entirely fictional: the institutions, balances,
 * paychecks and goal below belong to no one and were invented for this file.
 * Any likeness to a real archive is a coincidence.
 *
 * It is never loaded by itself. The owner of an empty archive can load it
 * from Settings › Data to see IRIS with something in it, and remove it again
 * from there; the tests load it as their fixture. Its shape — three liquidity
 * accounts with the reserved Cash, three investments, one trading account,
 * one snapshot, eight paychecks with two in one month, one goal — is what the
 * tests rely on.
 */

/** The date the tests load it at: every figure in them is computed from here. */
export const demoCreatedAt = "2026-08-25T00:00:00.000Z";

export function demoAccounts(createdAt: string = demoCreatedAt): Account[] {
  const account = (id: string, name: string, category: Account["category"], balance: number): Account =>
    ({ id, name, category, currency: "EUR", balance, includedInWealth: true, createdAt, lastUpdated: createdAt });
  return [
    account("banca-aurora", "Banca Aurora", "liquidity", 4820.35),
    account("conto-vela", "Conto Vela", "liquidity", 615.4),
    account("cash", "Cash", "liquidity", 180),
    account("broker-orione", "Broker Orione", "investments", 3120.8),
    account("crypto-delta", "Crypto Delta", "investments", 210),
    account("lira-invest", "Lira Invest", "investments", 48.25),
    account("trading-nord", "Trading Nord", "trading", 425.6),
  ];
}

/** The Cash Counter behind the Cash account's 180 €: one 10, one 20, three 50s. */
export const demoCashDenominations: CashDenomination[] = [
  { denomination: 5, quantity: 0 },
  { denomination: 10, quantity: 1 },
  { denomination: 20, quantity: 1 },
  { denomination: 50, quantity: 3 },
  { denomination: 100, quantity: 0 },
  { denomination: 200, quantity: 0 },
  { denomination: 500, quantity: 0 },
];

export function demoSnapshot(createdAt: string = demoCreatedAt): WealthSnapshot {
  const accounts = demoAccounts(createdAt);
  return {
    id: "initial-snapshot",
    createdAt,
    totalWealth: calculateTotalWealth(accounts),
    accountBalances: accounts.map(({ id: accountId, balance, includedInWealth }) => ({ accountId, balance, includedInWealth })),
  };
}

export const demoPaychecks: Paycheck[] = [
  { id: "jan-27", paymentDate: "2026-01-27", amount: 1450 },
  { id: "feb-27", paymentDate: "2026-02-27", amount: 1450 },
  { id: "mar-27", paymentDate: "2026-03-27", amount: 1465 },
  { id: "apr-27", paymentDate: "2026-04-27", amount: 1465 },
  { id: "may-27", paymentDate: "2026-05-27", amount: 1480 },
  { id: "jun-26", paymentDate: "2026-06-26", amount: 1480 },
  { id: "jun-30", paymentDate: "2026-06-30", amount: 320 },
  { id: "jul-27", paymentDate: "2026-07-27", amount: 1495 },
];

export const demoGoals: WealthGoal[] = [
  { id: "wealth-goal", name: "Total Wealth", targetAmount: 20000 },
];
