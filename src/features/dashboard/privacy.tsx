"use client";

import { createContext, useContext, Fragment, type ReactNode } from "react";
import React from "react";
import { Eye, EyeOff } from "lucide-react";
import { useLanguage } from "@/features/i18n/language";
import {
  accountNamesHidden as accountNamesHiddenPreference,
  amountsHidden as amountsHiddenPreference,
  percentagesHidden as percentagesHiddenPreference,
} from "@/features/settings/preferences";

// Long enough to cover the reveal fade (--duration-quick), short enough that
// figures mounting later render without it.
const revealWindowMs = 400;

/*
 * What the dashboard shows of itself. Three independent terms, never one
 * "private mode": someone demonstrating the app may want the figures gone and
 * the account names kept, or the reverse. They change what is rendered and
 * nothing else — the records are untouched, and a backup exports them in full
 * whatever these say.
 *
 * The state itself lives in the device-preference store (settings/preferences),
 * so it survives a reload and every view reads the same answer.
 */
type PrivacyState = {
  amountsHidden: boolean;
  percentagesHidden: boolean;
  accountNamesHidden: boolean;
  toggleAmounts: () => void;
  setAmountsHidden: (value: boolean) => void;
  setPercentagesHidden: (value: boolean) => void;
  setAccountNamesHidden: (value: boolean) => void;
};

const noop = () => { return; };

const PrivacyContext = createContext<PrivacyState>({
  amountsHidden: false,
  percentagesHidden: false,
  accountNamesHidden: false,
  toggleAmounts: noop,
  setAmountsHidden: noop,
  setPercentagesHidden: noop,
  setAccountNamesHidden: noop,
});

export function usePrivacy(): PrivacyState {
  return useContext(PrivacyContext);
}

/**
 * Revealing may ease the figures in; hiding never does, so no value stays
 * readable for a single frame on the way to privacy.
 */
function markReveal(hiding: boolean) {
  if (hiding) {
    delete document.documentElement.dataset.privacyReveal;
    return;
  }
  document.documentElement.dataset.privacyReveal = "true";
  window.setTimeout(() => { delete document.documentElement.dataset.privacyReveal; }, revealWindowMs);
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const amountsHidden = amountsHiddenPreference.use();
  const percentagesHidden = percentagesHiddenPreference.use();
  const accountNamesHidden = accountNamesHiddenPreference.use();

  const setAmountsHidden = (value: boolean) => {
    markReveal(value);
    amountsHiddenPreference.set(value);
  };

  return (
    <PrivacyContext.Provider
      value={{
        amountsHidden,
        percentagesHidden,
        accountNamesHidden,
        toggleAmounts: () => setAmountsHidden(!amountsHidden),
        setAmountsHidden,
        setPercentagesHidden: (value) => { markReveal(value); percentagesHiddenPreference.set(value); },
        setAccountNamesHidden: (value) => { markReveal(value); accountNamesHiddenPreference.set(value); },
      }}
    >
      {children}
    </PrivacyContext.Provider>
  );
}

/**
 * The eye. In the top bar it is an icon alone, so it names itself on hover
 * (`tooltip`), like the theme and Settings icons beside it.
 */
export function PrivacyToggle({ className, tooltip = false }: { className?: string; tooltip?: boolean }) {
  const { amountsHidden, toggleAmounts } = usePrivacy();
  const { text } = useLanguage();
  const label = amountsHidden ? text("Mostra importi", "Show amounts") : text("Nascondi importi", "Hide amounts");

  // The name is the action the eye offers now, so it carries no pressed state:
  // "Show amounts, pressed" would contradict itself.
  return (
    <button
      aria-label={label}
      className={["button button--ghost privacy-toggle", className].filter(Boolean).join(" ")}
      onClick={toggleAmounts}
      title={tooltip ? label : undefined}
      type="button"
    >
      {/* Both icons share one slot and cross-fade; the state lives on the wrapper. */}
      <span aria-hidden="true" className="icon-swap" data-state={amountsHidden ? "hidden" : "shown"}>
        <span className="icon-swap__icon" data-icon="shown"><Eye size={20} /></span>
        <span className="icon-swap__icon" data-icon="hidden"><EyeOff size={20} /></span>
      </span>
    </button>
  );
}

function maskDigits(text: string): string {
  return text.replace(/\d/g, "*");
}

function maskNode(node: ReactNode): ReactNode {
  if (typeof node === "string") {
    return maskDigits(node);
  }
  if (typeof node === "number") {
    return maskDigits(String(node));
  }
  if (Array.isArray(node)) {
    return node.map((child, index) => <Fragment key={index}>{maskNode(child)}</Fragment>);
  }
  if (node && typeof node === "object" && "$$typeof" in node) {
    const element = node as React.ReactElement<{ children?: ReactNode }>;
    return React.cloneElement(element, { children: maskNode(element.props.children) });
  }
  return node;
}

export function Sensitive({ children }: { children: ReactNode }) {
  const { amountsHidden } = usePrivacy();
  const { text } = useLanguage();

  if (!amountsHidden) {
    return <span className="sensitive">{children}</span>;
  }

  return (
    <span className="sensitive is-hidden" aria-label={text("Importo nascosto", "Hidden amount")}>
      {maskNode(children)}
    </span>
  );
}

/**
 * A share, a change or a progress in percent. Its own term, separate from the
 * amounts: the digits are masked the same way, so the text keeps its width and
 * nothing around it moves when the term is turned on.
 */
export function Percent({ children }: { children: ReactNode }) {
  const { percentagesHidden } = usePrivacy();
  const { text } = useLanguage();

  if (!percentagesHidden) return <>{children}</>;

  return (
    <span aria-label={text("Percentuale nascosta", "Percentage hidden")} className="sensitive is-hidden">
      {maskNode(children)}
    </span>
  );
}

/*
 * A name the owner typed: an account's, and nothing the interface needs to
 * stay understandable. Category, balance and every label keep their words —
 * hiding "Liquidità" would only make the page unreadable.
 * The mask keeps the name's own length, within bounds, so a row does not jump
 * when it is turned on; the real name stays in the accessibility tree's reach
 * through the label, never in the visible text.
 */
const maskedNameMin = 3;
const maskedNameMax = 16;

export function maskAccountName(name: string): string {
  const length = Math.min(Math.max(name.trim().length, maskedNameMin), maskedNameMax);
  return "•".repeat(length);
}

export function AccountName({ name }: { name: string }) {
  const { accountNamesHidden } = usePrivacy();
  const { text } = useLanguage();

  if (!accountNamesHidden) return <>{name}</>;

  return (
    <span aria-label={text("Nome del conto nascosto", "Account name hidden")} className="sensitive is-hidden">
      {maskAccountName(name)}
    </span>
  );
}
