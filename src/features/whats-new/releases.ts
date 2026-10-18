import type { SettingTarget } from "@/features/settings/setting-link";

/*
 * IRIS's release notes (owner, 18 Oct 2026): what changed, written for the
 * person using IRIS — never commit messages. Newest first. The first entry
 * is the version package.json carries (a test holds them together), and the
 * one the "Novità" button compares with the version this device last saw.
 * A note about a setting carries the row it lives on: the panel offers
 * "Prova" and takes the reader straight there.
 */

export type ReleaseNote = {
  /** Italian, English. */
  text: readonly [string, string];
  tryIt?: SettingTarget;
};

export type Release = {
  version: string;
  /** The day it was released, YYYY-MM-DD. */
  date: string;
  title: readonly [string, string];
  notes: readonly ReleaseNote[];
};

export const releases: readonly Release[] = [
  {
    version: "0.2.0",
    date: "2026-10-18",
    title: ["Pagine più chiare, più scelte per l'aspetto", "Clearer pages, more choices for the look"],
    notes: [
      {
        text: [
          "Ogni pagina si apre con un'intestazione che riassume i suoi dati principali. Flussi di cassa, Conti e Andamento hanno grafici di sintesi; la tabella dei conti raggruppa per categoria e si comprime.",
          "Every page opens with a header summing up its main figures. Cash Flow, Accounts and Progress have summary charts; the accounts table groups by category and folds.",
        ],
      },
      {
        text: [
          "Obiettivi: il simulatore «E se…», le tappe, lo storico dei progressi e più obiettivi insieme.",
          "Goals: the “What if…” simulator, milestones, progress history and several goals at once.",
        ],
      },
      {
        text: [
          "Proiezioni diventa «Posso permettermelo?»: una domanda, idee pronte, il tuo ritmo reale e le scelte salvate.",
          "Projections becomes “Can I afford it?”: one question, ready-made ideas, your actual pace and saved choices.",
        ],
      },
      {
        text: ["Lo zoom di tutta la pagina, dal 25% al 200%.", "Zoom for the whole page, from 25% to 200%."],
        tryIt: { section: "experience", setting: "zoom" },
      },
      {
        text: ["Card in vetro o opache.", "Glass or opaque cards."],
        tryIt: { section: "experience", setting: "surfaces" },
      },
      {
        text: ["Uno sfondo animato dietro le pagine, o fermo.", "A moving background behind the pages, or a still one."],
        tryIt: { section: "experience", setting: "app-background" },
      },
      {
        text: ["Tre modi di cambiare pagina: dissolvenza, a cascata o cinematica.", "Three ways to change page: fade, cascade or cinematic."],
        tryIt: { section: "experience", setting: "page-transition" },
      },
      {
        text: [
          "Schermata di blocco: uno sfondo diverso a ogni blocco, se lo vuoi, e il link al progetto su GitHub.",
          "Lock screen: a different background at every lock, if you want it, and the link to the project on GitHub.",
        ],
        tryIt: { section: "experience", setting: "background" },
      },
      {
        text: [
          "Le Impostazioni si aprono dal fondo della barra laterale, le notifiche compaiono in basso al centro, e questo pannello racconta le novità.",
          "Settings open from the foot of the sidebar, notifications appear at the bottom centre, and this panel tells what is new.",
        ],
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-13",
    title: ["La prima versione", "The first version"],
    notes: [
      {
        text: [
          "La schermata di blocco con il PIN, la Panoramica da disporre a piacere, conti, flussi di cassa, andamento, obiettivi e proiezioni.",
          "The lock screen with its PIN, an Overview you arrange yourself, accounts, cash flow, progress, goals and projections.",
        ],
      },
      {
        text: [
          "Tutto resta su questo dispositivo: backup da esportare e ripristinare, una visita guidata e un archivio d'esempio per provare.",
          "Everything stays on this device: backups to export and restore, a guided tour and an example archive to try things out.",
        ],
      },
    ],
  },
];

export const latestRelease = releases[0];
