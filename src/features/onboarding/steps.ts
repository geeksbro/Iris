import type { Side } from "./geometry";

/*
 * The tour, as data. Six sections, each one or more steps on a real part of
 * the interface, named by a `data-tour` attribute the component carries (the
 * only contract between the tour and the views: class names and test ids are
 * free to change). A step that belongs to another view names it, and the tour
 * goes there before looking for its target; going back goes to the previous
 * step's view the same way. A target that is not on screen — a panel the
 * owner removed from the Overview, say — leaves its step as a centred card:
 * the tour never waits on data or layout to move on.
 *
 * Nothing here opens a window or touches a record: the tour points, the owner
 * acts later.
 */

export type TourView = "overview" | "accounts" | "goals" | "scenario" | "settings";

type Copy = readonly [italian: string, english: string];

export type TourStep = {
  id: string;
  /** Which of the six sections (0–5) the step belongs to. */
  section: number;
  /** The view the target lives in; absent for the centred cards. */
  view?: TourView;
  /** data-tour names; the opening covers all of those found. Absent: a centred card. */
  targets?: readonly string[];
  /** Tried in turn before the opening is drawn without them: the panel is centred. */
  fallbackTargets?: readonly string[];
  /** Sides for the panel, best first. */
  prefer?: readonly Side[];
  title: Copy;
  body: Copy;
};

export const tourSections: readonly Copy[] = [
  ["Benvenuto", "Welcome"],
  ["Panoramica", "Overview"],
  ["Aggiorna saldi", "Update balances"],
  ["Conti", "Accounts"],
  ["Obiettivi e Proiezioni", "Goals & Projections"],
  ["Impostazioni", "Settings"],
];

const railSides: readonly Side[] = ["right", "top", "bottom", "left"];

export const tourSteps: readonly TourStep[] = [
  {
    id: "welcome",
    section: 0,
    title: ["Benvenuto in IRIS", "Welcome to IRIS"],
    body: [
      "IRIS tiene in ordine il tuo patrimonio: dove si trova, come cambia nel tempo e quanto manca ai tuoi obiettivi.",
      "IRIS keeps your wealth in order: where it sits, how it changes over time and how far you are from your goals.",
    ],
  },
  {
    id: "overview-wealth",
    section: 1,
    view: "overview",
    targets: ["overview-wealth"],
    fallbackTargets: ["overview"],
    title: ["Il patrimonio, a colpo d'occhio", "Your wealth at a glance"],
    body: [
      "Il totale è la somma dei saldi dei conti che includi nel patrimonio. Le metriche della Panoramica confrontano gli aggiornamenti salvati — l'ultimo, da inizio mese, da inizio anno, il massimo storico — e restano vuote finché non ce ne sono abbastanza.",
      "The total adds up the balances of the accounts you include in your wealth. The Overview's metrics compare saved updates — the latest, month to date, year to date, the all-time high — and stay empty until there are enough of them.",
    ],
  },
  {
    id: "update-balances",
    section: 2,
    view: "overview",
    targets: ["update-balances"],
    prefer: ["top", "right", "bottom", "left"],
    title: ["Aggiorna i saldi con regolarità", "Update your balances regularly"],
    body: [
      "Quando i saldi cambiano, aggiornali da qui. Ogni aggiornamento salva una rilevazione datata: lo storico, l'Andamento, le variazioni e le stime degli Obiettivi nascono soltanto da queste rilevazioni. Più sono regolari, più sono attendibili.",
      "When your balances change, update them here. Each update saves a dated snapshot: the history, the Trend, the changes and the Goals' estimates are built from these snapshots alone. The more regular they are, the more reliable.",
    ],
  },
  {
    id: "accounts-nav",
    section: 3,
    view: "accounts",
    targets: ["nav-accounts"],
    prefer: railSides,
    title: ["I tuoi conti", "Your accounts"],
    body: [
      "In Conti elenchi dove si trova il patrimonio: conti correnti, contanti, broker, exchange. Puoi includere o escludere ciascun conto dal totale.",
      "Accounts lists where your wealth sits: current accounts, cash, brokers, exchanges. Each account can be included in the total or left out of it.",
    ],
  },
  {
    id: "accounts-add",
    section: 3,
    view: "accounts",
    targets: ["accounts-actions"],
    fallbackTargets: ["accounts"],
    title: ["Categorie e tempi di accesso", "Categories and access"],
    body: [
      "Ogni conto ha una categoria — Liquidità, Investimenti o Trading — e un profilo di accesso che scegli tu: Immediato, A giorni o Vincolato. Così IRIS mostra quanta parte del patrimonio puoi usare subito. Il conto Contanti c'è già: si aggiorna con «Conta contanti».",
      "Each account has a category — Liquidity, Investments or Trading — and an access profile you choose: Immediate, Within days or Locked. That is how IRIS shows how much of your wealth you can use right away. The Cash account is already there: Cash Counter keeps it up to date.",
    ],
  },
  {
    id: "goals-projections-nav",
    section: 4,
    view: "goals",
    targets: ["nav-goals", "nav-scenario"],
    prefer: railSides,
    title: ["Obiettivi e Proiezioni", "Goals and Projections"],
    body: [
      "Negli Obiettivi fissi un traguardo, di patrimonio o di liquidità, e ne segui l'avanzamento; le stime compaiono quando lo storico basta. Nelle Proiezioni metti alla prova delle ipotesi.",
      "In Goals you set a target, for total wealth or for liquidity, and follow your progress; estimates appear once there is enough history. In Projections you try out assumptions.",
    ],
  },
  {
    id: "projections",
    section: 4,
    view: "scenario",
    targets: ["projections-header"],
    fallbackTargets: ["projections"],
    title: ["Simulazioni, non previsioni", "Simulations, not forecasts"],
    body: [
      "Le Proiezioni confrontano due traiettorie costruite sulle condizioni che imposti. Sono un banco di prova isolato: nulla di ciò che cambi qui modifica conti, saldi o storico, e «Ripristina scenario» riporta i valori di partenza.",
      "Projections compare two trajectories built on the conditions you set. They are an isolated test bench: nothing you change here alters your accounts, balances or history, and Reset scenario brings back the starting values.",
    ],
  },
  {
    id: "settings-gear",
    section: 5,
    view: "scenario",
    targets: ["settings"],
    prefer: ["bottom", "left", "top", "right"],
    title: ["Impostazioni", "Settings"],
    body: [
      "L'ingranaggio apre le impostazioni di questo dispositivo. Accanto, nella barra: lingua, importi nascosti, tema, suoni e il lucchetto per bloccare subito.",
      "The gear opens this device's settings. Beside it in the bar: language, hidden amounts, theme, sounds and the padlock that locks at once.",
    ],
  },
  {
    id: "settings-groups",
    section: 5,
    view: "settings",
    targets: ["settings-index"],
    prefer: ["right", "bottom", "top", "left"],
    title: ["Privacy, sicurezza e backup", "Privacy, security and backup"],
    body: [
      "Qui cambi il PIN e il blocco automatico, nascondi importi e nomi dei conti, scegli tema e pagina iniziale. In Dati esporti un backup: è l'unico modo per conservare o spostare i tuoi dati fuori da questo browser.",
      "Here you change the PIN and the auto-lock, hide amounts and account names, choose the theme and the start page. In Data you export a backup: the only way to keep or move your data outside this browser.",
    ],
  },
  {
    id: "settings-tour",
    section: 5,
    view: "settings",
    targets: ["settings-tour"],
    fallbackTargets: ["settings-index"],
    prefer: ["top", "bottom", "left", "right"],
    title: ["Rivedi il tour quando vuoi", "Take the tour again any time"],
    body: [
      "«Ripeti tutorial» lo riavvia da capo. Non tocca dati, PIN o preferenze.",
      "Take the tour again starts it from the beginning. It touches no data, PIN or preference.",
    ],
  },
  {
    id: "done",
    section: 5,
    title: ["Tutto pronto", "You're all set"],
    body: [
      "IRIS è pronto. Ecco da dove cominciare:",
      "IRIS is ready. Here is where to start:",
    ],
  },
];

/** The steps with a target: the ones the progress counts. */
export const guidedSteps = tourSteps.filter((step) => step.targets);
