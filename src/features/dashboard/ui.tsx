import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

import { ArrowLeft, ArrowUpRight, LoaderCircle, X } from "lucide-react";

import { formatCurrency } from "@/domain/formatters";
import type { Account, AccountCategory, PaycheckType } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";

import { useCountUp } from "./entrance";
import { usePrivacy } from "./privacy";

function maskAmount(text: string): string {
  return text.replace(/\d/g, "*");
}

export const categoryLabels: Record<AccountCategory, string> = {
  liquidity: "Liquidity",
  investments: "Investments",
  trading: "Trading",
};

// Validated as a set (dataviz validate_palette, light, all pairs): worst CVD
// separation ΔE 15.4, worst normal-vision ΔE 20.0, every slot ≥ 3:1 on white.
// Blue/violet pairs were rejected: they collapse for deutan readers.
export const categoryColors: Record<AccountCategory, string> = {
  liquidity: "#3E63DD",
  investments: "#0F9FA8",
  trading: "#C08A2E",
};

const paycheckTypeNames: Record<PaycheckType, [italian: string, english: string]> = {
  salary: ["Stipendio", "Salary"],
  "extra-month": ["Mensilità extra", "Extra month"],
  bonus: ["Bonus o premio", "Bonus"],
  freelance: ["Freelance", "Freelance"],
  other: ["Altro", "Other"],
};

/** The name of an income type, in the interface's language. */
export function paycheckTypeLabel(type: PaycheckType, text: (italian: string, english: string) => string): string {
  return text(...paycheckTypeNames[type]);
}

export const globalDialogFocusFallbackId = "global-dialog-focus-fallback";

export function accountDialogFocusId(accountId: string): string {
  return `account-dialog-focus-${accountId}`;
}

export function paycheckRowFocusId(paycheckId: string): string {
  return `paycheck-row-focus-${paycheckId}`;
}

/** The Overview card that opens a category's detail view; focus returns to it on the way back. */
export function categoryDetailFocusId(category: AccountCategory): string {
  return `category-detail-focus-${category}`;
}

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(value: string, options?: { includeTime?: boolean; timeZone?: string; locale?: string }): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(options?.locale ?? "it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(options?.timeZone ? { timeZone: options.timeZone } : {}),
    ...(options?.includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

export function formatLocalCalendarDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatPercent(value: number, digits = 2, locale = "it-IT"): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value) + "%";
}

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ className, variant = "secondary", children, ...props }: ButtonProps) {
  return (
    <button className={cx("button", `button--${variant}`, className)} {...props}>
      {children}
    </button>
  );
}

/*
 * Motion helpers. Motion marks a change of state, never the page itself:
 * nothing here animates on first render.
 */

const MotionSettledContext = createContext(false);

/** Marks the end of a view's first render; content mounting after it is a change of state. */
export function MotionScope({ children }: { children: ReactNode }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSettled(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <MotionSettledContext.Provider value={settled}>{children}</MotionSettledContext.Provider>;
}

type EnteringProps = HTMLAttributes<HTMLElement> & {
  as?: "article" | "div" | "dl" | "h2" | "p" | "section" | "span";
  /** "state" swaps text in place with a slight blur; "block" eases a block in without one. */
  variant?: "block" | "state";
};

/**
 * An element that eases in only when it appears after its view has loaded,
 * so a replaced state reads as replaced. Present at load, it renders as is.
 * Re-key it to replay the swap when its content changes state in place.
 */
export function Entering({ as = "div", variant = "block", className, ...props }: EnteringProps) {
  const settled = useContext(MotionSettledContext);
  const [enters] = useState(settled);
  return createElement(as, { ...props, className: cx(className, enters && `motion-enter motion-enter--${variant}`) });
}

/**
 * Pending feedback that never flickers: the label keeps the button's name and
 * width, and the spinner fades in only if the operation outlasts the pending
 * delay. A fast save shows nothing; nothing is slowed down to be seen.
 */
export function PendingLabel({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <span className="pending-label" data-pending={pending ? "true" : undefined}>
      <span className="pending-label__text">{children}</span>
      <LoaderCircle aria-hidden="true" className="pending-label__spinner" size={16} />
    </span>
  );
}

export type ActionGlyphState = "idle" | "pending" | "done";

/** One icon slot for an action that stays on screen: its icon, a spinner, then a drawn check. */
export function ActionGlyph({ idle, state }: { idle: ReactNode; state: ActionGlyphState }) {
  return (
    <span aria-hidden="true" className="action-glyph" data-state={state}>
      <span className="action-glyph__icon" data-icon="idle">{idle}</span>
      <span className="action-glyph__icon" data-icon="pending"><LoaderCircle className="action-glyph__spinner" size={16} /></span>
      <span className="action-glyph__icon" data-icon="done">
        <svg fill="none" height={16} viewBox="0 0 24 24" width={16}>
          <path className="action-glyph__check" d="M20 6 9 17l-5-5" pathLength={1} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} />
        </svg>
      </span>
    </span>
  );
}

/*
 * Window chrome shared by every window in the app. The lock screen keeps one
 * decorative red control. Application overlays use the same red control as a
 * real button that closes the window: it means "close", never "delete".
 */
export function WindowTrafficLights() {
  return (
    <span aria-hidden="true" className="window-controls">
      <span className="window-control window-control--close" />
    </span>
  );
}

type WindowCloseControlProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  ref?: Ref<HTMLButtonElement>;
};

/* The dot stays 12px; the button around it is a 24px target. */
export function WindowCloseControl({ className, label, ...props }: WindowCloseControlProps) {
  return (
    <button aria-label={label} className={cx("window-close", className)} title={label} type="button" {...props}>
      <span aria-hidden="true" className="window-control window-control--close">
        <X size={8} strokeWidth={3.2} />
      </span>
    </button>
  );
}

/*
 * Parent navigation for a child view. It returns to the one view the child
 * belongs to, never to browser history, so it cannot leave the dashboard.
 * Overlays keep their own close control instead: back and close stay distinct.
 */
export function BackControl({ parentLabel, onBack }: { parentLabel: string; onBack: () => void }) {
  const { text } = useLanguage();
  return (
    <Button
      aria-label={text(`Indietro, torna a ${parentLabel}`, `Back to ${parentLabel}`)}
      className="back-control"
      onClick={onBack}
      type="button"
    >
      <ArrowLeft aria-hidden="true" size={16} strokeWidth={2.25} />
      <span>{text("Indietro", "Back")}</span>
    </Button>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  action,
  icon,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  /** A decorative mark set in a tile before the eyebrow and title. */
  icon?: ReactNode;
}) {
  return (
    <div className={cx("section-heading", icon ? "section-heading--with-icon" : undefined)}>
      {icon ? <span aria-hidden="true" className="section-heading__icon">{icon}</span> : null}
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

/**
 * An amount. With `countUp`, it counts up to its value during the dashboard
 * entrance (never while amounts are hidden): only the drawn figure counts,
 * aria-hidden, while the accessibility tree keeps the real value throughout.
 */
export function Money({ amount, className, countUp = false }: { amount: number; className?: string; countUp?: boolean }) {
  const { amountsHidden } = usePrivacy();
  const figureRef = useRef<HTMLSpanElement>(null);
  const counting = useCountUp(amount, countUp && !amountsHidden, (current) => {
    if (figureRef.current) figureRef.current.textContent = formatCurrency(current);
  });
  const text = amountsHidden ? maskAmount(formatCurrency(amount)) : formatCurrency(amount);
  return (
    <span className={cx("money", amountsHidden && "is-masked", className)}>
      {counting ? (
        <>
          <span aria-hidden="true" ref={figureRef} />
          <span className="visually-hidden">{text}</span>
        </>
      ) : text}
    </span>
  );
}

export function CategoryMark({ category }: { category: AccountCategory }) {
  const { categoryLabel } = useLanguage();
  return (
    <span className="category-mark" style={{ "--mark-color": categoryColors[category] } as React.CSSProperties}>
      <span aria-hidden="true" />
      {categoryLabel(category)}
    </span>
  );
}

export function AccountMark({ account }: { account: Pick<Account, "id" | "name" | "category"> }) {
  return (
    <span
      aria-hidden="true"
      className="account-monogram"
      data-testid={`account-mark-${account.id}`}
      style={{ "--mark-color": categoryColors[account.category] } as React.CSSProperties}
    >
      {account.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/**
 * Where a value comes from, as one quiet mark: a filled dot for a value
 * recorded in an update, a ring for one calculated from updates, a square for
 * one the user set. Shape differs as well as colour.
 */
export function BasisMark({ basis }: { basis: "observed" | "derived" | "defined" }) {
  return <i aria-hidden="true" className={`basis-mark basis-mark--${basis}`} />;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <ArrowUpRight aria-hidden="true" size={20} />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export function LoadingState() {
  const { text } = useLanguage();
  return (
    <main className="center-state" aria-live="polite">
      <LoaderCircle className="spin" aria-hidden="true" size={22} />
      <p>{text("Apertura del sistema patrimoniale locale…", "Opening your local wealth system…")}</p>
    </main>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { text } = useLanguage();
  return (
    <main className="center-state center-state--error" role="alert">
      <p className="eyebrow">{text("Dati locali non disponibili", "Local data unavailable")}</p>
      <h1>{text("Impossibile aprire la dashboard.", "We could not open the dashboard.")}</h1>
      <p>{message}</p>
      <Button variant="primary" onClick={onRetry}>{text("Riprova", "Try again")}</Button>
    </main>
  );
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cx("panel", className)} {...props} />;
}

export function Delta({
  amount,
  percentage,
  split = false,
  indicator = false,
  countUp = false,
}: {
  amount: number;
  percentage: number | null;
  /** Renders amount and percentage as two separate parts instead of one joined string. */
  split?: boolean;
  /** Draws the direction triangle inside the percentage pill. Split only, and
      only where the pill is the sign's own badge: the hero states direction
      with its own arrow beside the pill, so it leaves this off. */
  indicator?: boolean;
  /** Split only: amount and percentage count up during the dashboard entrance,
      like Money's countUp (owner, 27 Sep 2026: the change metrics panel). */
  countUp?: boolean;
}) {
  /* Two terms, two answers: the change in euro follows "hide amounts", the
     change in percent follows "hide percentages". Someone may want the sums
     gone and the direction kept, so neither masks the other. */
  const { amountsHidden, percentagesHidden } = usePrivacy();
  const signed = (value: number, format: (value: number) => string) => `${value > 0 ? "+" : ""}${format(value)}`;
  const amountRef = useRef<HTMLSpanElement>(null);
  const percentRef = useRef<HTMLSpanElement>(null);
  const amountCounting = useCountUp(amount, split && countUp && !amountsHidden, (current) => {
    if (amountRef.current) amountRef.current.textContent = signed(current, formatCurrency);
  });
  const percentCounting = useCountUp(percentage ?? 0, split && countUp && percentage !== null && !percentagesHidden, (current) => {
    if (percentRef.current) percentRef.current.textContent = signed(current, formatPercent);
  });
  const tone = amount > 0 ? "positive" : amount < 0 ? "negative" : "neutral";
  const amountText = signed(amount, formatCurrency);
  const percentText = percentage === null ? "—" : signed(percentage, formatPercent);
  const mask = (value: string) => (amountsHidden ? maskAmount(value) : value);
  const maskPercent = (value: string) => (percentagesHidden ? maskAmount(value) : value);

  if (split) {
    /* No triangle where there is no direction to point in: a null percentage
       renders as a dash, and a flat change has no up or down. */
    const showArrow = indicator && percentage !== null && tone !== "neutral";
    // While counting, the drawn figure is aria-hidden and the real one is read.
    const counted = (counting: boolean, ref: React.Ref<HTMLSpanElement>, text: string) => (counting
      ? <><span aria-hidden="true" ref={ref} /><span className="visually-hidden">{text}</span></>
      : text);
    return (
      <span className={cx("delta", "delta--split", `delta--${tone}`, amountsHidden && "is-masked")}>
        <span className="delta__amount">{counted(amountCounting, amountRef, mask(amountText))}</span>
        <span className={cx("delta__percent", percentagesHidden && "is-masked")}>
          {showArrow ? <span aria-hidden="true" className="delta__arrow" /> : null}
          {counted(percentCounting, percentRef, maskPercent(percentText))}
        </span>
      </span>
    );
  }

  return (
    <span className={cx("delta", `delta--${tone}`, (amountsHidden || percentagesHidden) && "is-masked")}>
      {`${mask(amountText)} · ${maskPercent(percentText)}`}
    </span>
  );
}
