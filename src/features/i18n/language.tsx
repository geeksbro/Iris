"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";

import type { AccountAccess, AccountCategory, AccountVolatility } from "@/domain/types";

export type Language = "it" | "en";

const languageStorageKey = "wealth-language";
const languageChangeEvent = "wealth-language-change";

type LanguageState = {
  language: Language;
  locale: "it-IT" | "en-GB";
  text: (italian: string, english: string) => string;
  reason: (english: string) => string;
  categoryLabel: (category: AccountCategory) => string;
  accessLabel: (access?: AccountAccess) => string;
  volatilityLabel: (volatility?: AccountVolatility) => string;
  toggleLanguage: () => void;
};

const fallbackLanguageState: LanguageState = {
  language: "en",
  locale: "en-GB",
  text: (_italian, english) => english,
  reason: (english) => english,
  categoryLabel: (category) => ({ liquidity: "Liquidity", investments: "Investments", trading: "Trading" })[category],
  accessLabel: (access) => access
    ? ({ immediate: "Immediate", days: "Within days", locked: "Locked" })[access]
    : "Unclassified",
  volatilityLabel: (volatility) => volatility
    ? ({ stable: "Stable", moderate: "Moderate", volatile: "Volatile" })[volatility]
    : "Unclassified",
  toggleLanguage: () => undefined,
};

const LanguageContext = createContext<LanguageState>(fallbackLanguageState);

export function useLanguage(): LanguageState {
  return useContext(LanguageContext);
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore(subscribeToLanguage, getClientLanguage, getServerLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const toggleLanguage = () => {
    const next = language === "it" ? "en" : "it";
    try {
      window.localStorage.setItem(languageStorageKey, next);
      window.dispatchEvent(new Event(languageChangeEvent));
    } catch {
      return;
    }
  };

  const state: LanguageState = {
    language,
    locale: language === "it" ? "it-IT" : "en-GB",
    text: (italian, english) => language === "it" ? italian : english,
    reason: (english) => language === "it" ? (italianReasons[english] ?? english) : english,
    categoryLabel: (category) => language === "it"
      ? ({ liquidity: "Liquidità", investments: "Investimenti", trading: "Trading" })[category]
      : ({ liquidity: "Liquidity", investments: "Investments", trading: "Trading" })[category],
    accessLabel: (access) => {
      if (!access) return language === "it" ? "Non classificato" : "Unclassified";
      return language === "it"
        ? ({ immediate: "Immediato", days: "A giorni", locked: "Vincolato" })[access]
        : ({ immediate: "Immediate", days: "Within days", locked: "Locked" })[access];
    },
    volatilityLabel: (volatility) => {
      if (!volatility) return language === "it" ? "Non classificata" : "Unclassified";
      return language === "it"
        ? ({ stable: "Stabile", moderate: "Moderata", volatile: "Volatile" })[volatility]
        : ({ stable: "Stable", moderate: "Moderate", volatile: "Volatile" })[volatility];
    },
    toggleLanguage,
  };

  return <LanguageContext.Provider value={state}>{children}</LanguageContext.Provider>;
}

function subscribeToLanguage(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(languageChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(languageChangeEvent, onStoreChange);
  };
}

function getClientLanguage(): Language {
  try {
    return window.localStorage.getItem(languageStorageKey) === "en" ? "en" : "it";
  } catch {
    return "it";
  }
}

function getServerLanguage(): Language {
  return "it";
}

const italianReasons: Record<string, string> = {
  "Year-to-date change needs another observed snapshot.": "La variazione da inizio anno richiede un'altra rilevazione salvata.",
  "No observed snapshot is close enough to the start of the year.": "Nessuna rilevazione salvata è abbastanza vicina all'inizio dell'anno.",
  "Average monthly pace needs at least three observed snapshots.": "Il ritmo mensile medio richiede almeno tre rilevazioni salvate.",
  "Recent pace needs observed history.": "Il ritmo recente richiede uno storico osservato.",
  "Recent pace needs an observed baseline near 90 days ago.": "Il ritmo recente richiede una rilevazione salvata di circa 90 giorni fa.",
  "Acceleration needs two comparable observed periods.": "L'accelerazione richiede due periodi osservati confrontabili.",
  "Acceleration needs two non-overlapping observed periods of at least 60 days.": "L'accelerazione richiede due periodi osservati non sovrapposti di almeno 60 giorni.",
  "An all-time high needs an observed snapshot.": "Il massimo storico richiede una rilevazione salvata.",
  "A best period needs two observed snapshots.": "Il periodo migliore richiede due rilevazioni salvate.",
  "A worst period needs two observed snapshots.": "Il periodo peggiore richiede due rilevazioni salvate.",
  "Current trajectory needs an observed snapshot.": "La traiettoria corrente richiede una rilevazione salvata.",
  "Observed pace needs at least 60 days of history.": "Il ritmo osservato richiede almeno 60 giorni di storico.",
  "Target already reached.": "Obiettivo già raggiunto.",
  "Target date must be after the reference date.": "La data obiettivo deve essere successiva a oggi.",
  "Observed pace must be positive to estimate a target date.": "Il ritmo osservato deve essere positivo per stimare una data obiettivo.",
  "A valid reference date is required for a target estimate.": "Per stimare l'obiettivo serve una data di riferimento valida.",
  "Add a target date to calculate the required monthly pace.": "Aggiungi una data obiettivo per calcolare il ritmo mensile necessario.",
  "Historical snapshots lack immutable category metadata, so allocation cannot be reconstructed honestly.": "Le rilevazioni salvate non conservano le categorie dei conti, quindi l'allocazione storica non può essere ricostruita correttamente.",
  "Monthly review needs a valid YYYY-MM month.": "La revisione mensile richiede un mese valido nel formato AAAA-MM.",
  "No observed snapshot exists before this month.": "Non esiste una rilevazione salvata precedente a questo mese.",
  "No observed snapshot exists inside this month.": "Non esiste una rilevazione salvata in questo mese.",
  "Monthly change needs observed opening and closing snapshots.": "La variazione mensile richiede rilevazioni salvate di apertura e chiusura.",
  "A monthly ATH needs an observed closing snapshot.": "Il massimo storico mensile richiede una rilevazione salvata di chiusura.",
  "No new all-time high was first observed in this month.": "In questo mese non è stato osservato per la prima volta un nuovo massimo storico.",
  "Historical liquidity is unavailable because snapshots lack immutable category metadata.": "La liquidità storica non è disponibile perché le rilevazioni salvate non conservano le categorie dei conti.",
  "Goal progress movement needs observed opening and closing snapshots.": "La variazione dell'obiettivo richiede rilevazioni salvate di apertura e chiusura.",
  "Pace comparison needs an observed closing snapshot.": "Il confronto del ritmo richiede una rilevazione salvata di chiusura.",
  "Historical liquidity categories are unavailable in stored snapshots.": "Le rilevazioni salvate non conservano le categorie: il ritmo della Liquidità non è ricostruibile.",
};


/**
 * The top bar's language switch, as it was before 13 Sep 2026: it shows the
 * language it switches to ("EN" while the dashboard is Italian). Its name is
 * the action, as in the command search, so it carries no pressed state.
 */
export function LanguageToggle() {
  const { language, text, toggleLanguage } = useLanguage();
  const label = text("Passa all'inglese", "Switch to Italian");

  return (
    <button
      aria-label={label}
      className="button button--ghost topbar-icon language-toggle"
      onClick={toggleLanguage}
      title={label}
      type="button"
    >
      {/* The two codes sit on one track that rolls: the old one leaves, the new one arrives. */}
      <span aria-hidden="true" className="lang-roll" data-target={language === "it" ? "en" : "it"}>
        <span className="lang-roll__track">
          <span>EN</span>
          <span>IT</span>
        </span>
      </span>
    </button>
  );
}