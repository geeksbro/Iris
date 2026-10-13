import type { Account, CashDenomination } from "@/domain/types";

/*
 * What a new device starts with: an empty archive and the one record IRIS
 * cannot work without — the reserved Cash account, kept by the Cash Counter,
 * at zero. No balances, no history, no paychecks, no goal: the owner adds
 * their own (the guided tour shows where), or loads the fictional example
 * archive from Settings (demo.ts).
 *
 * Earlier versions filled a new archive with a set of accounts and figures.
 * A device that was initialised with them keeps them: this file is read only
 * by initializeDatabase, and only on a device that was never initialised.
 */
export const cashDenominationValues = [5, 10, 20, 50, 100, 200, 500] as const;

export function firstRunCashAccount(createdAt: string): Account {
  return { id: "cash", name: "Cash", category: "liquidity", currency: "EUR", balance: 0, includedInWealth: true, createdAt, lastUpdated: createdAt };
}

export const firstRunCashDenominations: CashDenomination[] = cashDenominationValues.map((denomination) => ({ denomination, quantity: 0 }));
