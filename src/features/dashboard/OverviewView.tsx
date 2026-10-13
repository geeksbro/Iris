import type { Account, AccountCategory, CashDenomination, Paycheck, WealthGoal, WealthSnapshot } from "@/domain/types";

import { useEntranceContent } from "./entrance";
import { OverviewWorkspace } from "./overview/Workspace";
import { cx } from "./ui";

/*
 * The Overview is a workspace and a default arrangement of it. What used to
 * be written here — the total, its change metrics, the three category cards
 * and the panels below them — lives in overview/registry.tsx, is placed by
 * overview/layout.ts and rendered by overview/Workspace.tsx. A device that
 * never arranges anything sees exactly the page this view used to draw.
 *
 * What is left here is what the view still owns: the data it is handed, and
 * the entrance it plays the first time a page load opens on it.
 */

export function OverviewView({
  accounts,
  snapshots,
  cashDenominations,
  paychecks,
  goal,
  totalWealth,
  onOpenAccount,
  onShowCategory,
  onShowAccounts,
  onShowGoals,
  onEditGoal,
  editing,
  onStopEditing,
}: {
  accounts: Account[];
  snapshots: WealthSnapshot[];
  cashDenominations: CashDenomination[];
  paychecks: Paycheck[];
  goal?: WealthGoal;
  totalWealth: number;
  onOpenAccount: (account: Account) => void;
  onShowCategory: (category: AccountCategory) => void;
  onShowAccounts: () => void;
  onShowGoals: () => void;
  onEditGoal: () => void;
  editing: boolean;
  onStopEditing: () => void;
}) {
  // The view the dashboard opens on plays the entrance in place of the view slide.
  const entering = useEntranceContent();

  return (
    /* The Overview is on screen: a marker that belongs to the view itself,
       not to any panel in it. The total carries one too, but the total is a
       panel now and a reader may take it off the page. */
    <div className={cx("overview-view", "view-enter", entering && "entrance-content")} data-testid="wealth-overview" data-tour="overview">
      <OverviewWorkspace
        accounts={accounts}
        editing={editing}
        onStopEditing={onStopEditing}
        cashDenominations={cashDenominations}
        goal={goal}
        onEditGoal={onEditGoal}
        onOpenAccount={onOpenAccount}
        onShowAccounts={onShowAccounts}
        onShowCategory={onShowCategory}
        onShowGoals={onShowGoals}
        paychecks={paychecks}
        snapshots={snapshots}
        totalWealth={totalWealth}
      />
    </div>
  );
}
