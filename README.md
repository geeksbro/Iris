# IRIS

IRIS è una dashboard per il patrimonio personale che funziona interamente nel
tuo browser. Tiene traccia di dove sono i tuoi soldi, di come cambiano nel
tempo e di quanto manca ai tuoi obiettivi. Non ha account, server o cloud.

L'interfaccia è in italiano e in inglese. *An English summary is at the end.*

> **Versione beta sperimentale.** Per provarla usa dati inventati: l'archivio
> resta nel browser e **non è cifrato**.

---

## Prima di iniziare: tre cose da sapere

1. **Il PIN non cifra i dati.** Il PIN blocca lo schermo di IRIS, ma
   l'archivio è salvato in chiaro nel browser. Chi può usare il tuo computer e
   il tuo browser può leggerlo con gli strumenti per sviluppatori. IRIS non è
   una cassaforte.
2. **Il backup è indispensabile.** I dati stanno solo nel browser di questo
   computer. Si perdono se cancelli i dati di navigazione, reinstalli il
   browser o cambi computer. Il backup è l'unica copia che sopravvive:
   **Impostazioni › Dati › Esporta backup**. IRIS te lo ricorda quando serve.
3. **Il PIN non si recupera.** Non esiste un account online: se dimentichi il
   PIN, puoi solo ripartire da zero e ripristinare un backup.

---

## Cosa serve

- Un computer **Windows 10 o 11**. Su macOS e Linux funziona da terminale:
  vedi [Per chi usa il terminale](#per-chi-usa-il-terminale).
- **Node.js**, versione LTS: si scarica gratis da
  [nodejs.org](https://nodejs.org). L'installazione chiede i permessi di
  amministratore. È l'unico passaggio che li richiede.
- Una connessione a internet **solo al primo avvio**, per scaricare i
  componenti (circa 550 MB su disco). Dopo, IRIS funziona offline.
- Un browser moderno: Chrome, Edge, Firefox o Safari.

## Installazione

1. **Scarica IRIS.** Puoi farlo in due modi:
   - dalla pagina del repository su GitHub: pulsante verde **Code** ›
     **Download ZIP**;
   - oppure con Git: `git clone <indirizzo del repository>`.
2. **Estrai lo ZIP.** Tasto destro sul file › **Estrai tutto…** e scegli una
   cartella, per esempio `Documenti\IRIS`. Non avviare IRIS dall'interno dello
   ZIP senza estrarlo.
3. **Avvia IRIS.** Fai doppio clic su **`Avvia IRIS.bat`**.
   - Se Windows mostra «Windows ha protetto il PC», clicca **Ulteriori
     informazioni**, poi **Esegui comunque**. Succede con i file scaricati da
     internet.
   - Se Node.js non è installato, IRIS lo dice e apre la pagina per
     scaricarlo.
4. **La prima volta ci vogliono alcuni minuti:** IRIS installa i suoi
   componenti e si prepara. Le volte successive parte in pochi secondi.
5. **Il browser si apre da solo** all'indirizzo **http://127.0.0.1:3737**.

## Primo utilizzo

1. **Crea un PIN** da 4 a 8 cifre.
2. IRIS si apre con un **archivio vuoto** e ti propone il **tutorial**: una
   visita guidata delle sezioni principali. Puoi saltarlo e rivederlo quando
   vuoi da *Impostazioni › Ripeti tutorial*.
3. **Aggiungi i tuoi conti** e salva il primo aggiornamento dei saldi.
   Per curiosare prima, carica l'**archivio di esempio** da
   *Impostazioni › Dati*: è completamente inventato e si toglie dallo stesso
   punto.

La lingua si cambia dal pulsante nella barra in alto.

## Uso di tutti i giorni

- **Per aprire IRIS**, fai doppio clic su `Avvia IRIS.bat`. Se IRIS è già
  accesa, si apre solo il browser.
- **Mentre la usi, lascia aperta la finestra nera.** Per spegnere IRIS basta
  chiuderla.
- **Chiudere la finestra o il browser non cancella niente.** I dati sono nel
  browser, non nella cartella di IRIS, e li ritrovi al prossimo avvio.
- **Usa sempre lo stesso browser e lo stesso indirizzo**
  (http://127.0.0.1:3737). Ogni browser ha un archivio suo, e anche la
  navigazione in incognito. Un altro browser mostrerà quindi un archivio
  vuoto, non un errore.

## Backup e ripristino

Tutto da **Impostazioni › Dati**:

- **Esporta backup.** Salva un file `.json` con tutti i tuoi dati. Conservalo in
  un posto privato: il file non è cifrato.
- **Verifica un backup.** Controlla che un file sia leggibile e completo, senza
  importarlo.
- **Ripristina.** Sostituisce i dati di questo browser con quelli del file,
  dopo averti chiesto conferma.

IRIS ti ricorda di fare un backup in tre casi:
- la prima volta che inserisci dati veri;
- quando l'ultimo backup ha più di 14 giorni;
- quando ci sono diverse modifiche non salvate.

Per provare il ripristino senza rischi, aprilo in una finestra di navigazione
in incognito: ha un archivio separato.

## Aggiornare IRIS

1. **Esporta un backup**, per sicurezza.
2. Scarica la nuova versione e sostituisci la vecchia cartella. Con Git basta
   `git pull`.
3. Avvia `Avvia IRIS.bat`: IRIS si aggiorna da sola e riapre lo **stesso
   indirizzo**, con i tuoi dati.

## Problemi frequenti

| Problema | Cosa fare |
|---|---|
| «IRIS ha bisogno di Node.js» | Installa Node.js LTS da [nodejs.org](https://nodejs.org), poi riavvia IRIS. |
| «L'installazione dei componenti non è riuscita» | Controlla la connessione e riprova. Se persiste, cancella la cartella `node_modules` dentro IRIS e riavvia. |
| «L'indirizzo di IRIS è occupato da un altro programma» | Un altro programma usa la porta 3737. Chiudilo e riavvia IRIS. IRIS non cambia porta da sola: con un indirizzo diverso vedresti un archivio vuoto. |
| Il browser non si apre | Apri tu http://127.0.0.1:3737 mentre la finestra nera è aperta. |
| L'archivio sembra vuoto | Controlla di usare lo stesso browser, non in incognito, e l'indirizzo http://127.0.0.1:3737. Se il browser ha cancellato i dati, ripristina l'ultimo backup. |
| Ho dimenticato il PIN | Cancella i dati del sito 127.0.0.1:3737 dalle impostazioni del browser, crea un nuovo PIN e ripristina un backup. |

## Disinstallare

1. Esporta un backup, se vuoi conservare i dati.
2. Cancella la cartella di IRIS.
3. Per cancellare anche i dati, eliminali dalle impostazioni del browser. Su
   Chrome: *Impostazioni › Privacy e sicurezza › Impostazioni sito › Visualizza
   autorizzazioni e dati memorizzati*, poi cerca `127.0.0.1`.

## Privacy

- **Nessun account, nessun cloud, nessuna analisi d'uso.** IRIS non invia i
  tuoi dati da nessuna parte. La telemetria di Next.js è disattivata.
- **Il piccolo server di IRIS risponde solo a questo computer** (127.0.0.1).
  Non è raggiungibile dalla rete e serve solo i file dell'applicazione: i dati
  non passano da lì.
- **Non servono permessi di amministratore** per avviare IRIS. Lo script non
  modifica nulla fuori dalla sua cartella: le uniche eccezioni sono la cache di
  npm, che si trova nel tuo profilo utente, e i dati salvati nel browser.

---

## Per chi usa il terminale

Servono Node.js 20.9 o successivo e npm.

```bash
npm start           # come Avvia IRIS.bat: installa, prepara, apre il browser
npm run dev         # server di sviluppo
npm run build       # sito statico in out/
```

Opzioni del launcher: `node scripts/iris.mjs --port <n>` usa una porta senza
salvarla; `--no-open` non apre il browser; `--rebuild` prepara di nuovo IRIS.
La porta scelta al primo avvio è salvata in `.iris-local/port.txt`.

Controlli:

```bash
npm run lint
npx tsc --noEmit
npm test            # Vitest (jsdom, fake-indexeddb)
npx playwright install chromium   # solo la prima volta
npm run test:e2e    # Playwright: prepara IRIS e la prova in Chromium
```

Tecnologie: Next.js (App Router, export statico), React, TypeScript, Dexie
(IndexedDB), Zod, Recharts, Radix, lucide-react. I suoni sono sintetizzati con
la Web Audio API.

---

## English summary

IRIS is a local-first personal wealth dashboard that runs entirely in the
browser. It has no account, no server and no cloud.

- **Install.** Install Node.js LTS from [nodejs.org](https://nodejs.org).
  Download this repository (*Code › Download ZIP*) and extract it. Then
  double-click **`Avvia IRIS.bat`**. On macOS or Linux, run `npm start`
  instead. The first start installs and builds IRIS, which takes a few minutes.
  The browser then opens **http://127.0.0.1:3737**.
- **The PIN does not encrypt anything.** It locks the interface; the archive is
  stored unencrypted in the browser's IndexedDB.
- **Back up.** Use *Settings › Data › Export backup*: the backup is the only
  copy that survives the browser's data being cleared.
- **Keep the same browser and address.** The archive belongs to the exact
  address, port included. The launcher therefore always reuses the same port
  and refuses to move to another one silently.
- **Private.** The server answers only this computer, Next.js telemetry is
  disabled, and IRIS sends nothing anywhere.
