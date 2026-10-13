# Guida completa di IRIS

[← Torna alla presentazione](../README.md)

- [Cosa serve](#cosa-serve)
- [Installazione passo per passo](#installazione-passo-per-passo)
- [Primo utilizzo](#primo-utilizzo)
- [Uso di tutti i giorni](#uso-di-tutti-i-giorni)
- [Backup e ripristino](#backup-e-ripristino)
- [Aggiornare IRIS](#aggiornare-iris)
- [Problemi frequenti](#problemi-frequenti)
- [Disinstallare](#disinstallare)
- [Privacy e sicurezza](#privacy-e-sicurezza)
- [Per sviluppatori](#per-sviluppatori)
- [English summary](#english-summary)

---

## Cosa serve

- **Windows 10 o 11.** Su macOS e Linux IRIS funziona da terminale: vedi
  [Per sviluppatori](#per-sviluppatori).
- **Node.js, versione LTS** (20.9 o successiva), gratuito su
  [nodejs.org](https://nodejs.org). L'installazione di Node.js chiede i
  permessi di amministratore: è l'unico passaggio che li richiede.
- **Una connessione a internet solo al primo avvio**, per scaricare i
  componenti. Occupano circa 550 MB su disco. Dopo, IRIS funziona offline.
- **Un browser moderno:** Chrome, Edge, Firefox o Safari.

## Installazione passo per passo

1. **Scarica IRIS.** Dalla pagina del repository su GitHub premi il pulsante
   verde **Code › Download ZIP**. Se usi Git:
   `git clone https://github.com/geeksbro/Iris.git`.
2. **Estrai lo ZIP.** Fai tasto destro sul file, scegli **Estrai tutto…** e
   indica una cartella, per esempio `Documenti\IRIS`. Non avviare IRIS
   dall'interno dello ZIP.
3. **Avvia IRIS.** Fai doppio clic su **`Avvia IRIS.bat`**.
   - Se Windows mostra «Windows ha protetto il PC», premi **Ulteriori
     informazioni** e poi **Esegui comunque**. Succede con i file scaricati da
     internet.
   - Se Node.js non è installato, IRIS lo dice e apre la pagina da cui
     scaricarlo.
4. **Aspetta qualche minuto la prima volta.** IRIS installa i suoi componenti e
   si prepara. Le volte successive parte in pochi secondi.
5. **Il browser si apre da solo** all'indirizzo **http://127.0.0.1:3737**.

## Primo utilizzo

1. **Crea un PIN** da 4 a 8 cifre.
2. IRIS si apre con un **archivio vuoto** e ti propone il **tutorial**. Puoi
   saltarlo e rivederlo quando vuoi da *Impostazioni › Ripeti tutorial*.
3. **Aggiungi i tuoi conti** e salva il primo aggiornamento dei saldi.

Vuoi curiosare prima di inserire qualcosa? Carica l'**archivio di esempio** da
*Impostazioni › Dati*: è completamente inventato e si toglie dallo stesso punto.

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
  navigazione in incognito ne ha uno separato. Un altro browser mostra quindi
  un archivio vuoto, non un errore.

## Backup e ripristino

Tutto si trova in **Impostazioni › Dati**:

- **Esporta backup** salva un file `.json` con tutti i tuoi dati. Conservalo in
  un posto privato: il file non è cifrato.
- **Verifica un backup** controlla che un file sia leggibile e completo, senza
  importarlo.
- **Ripristina da un backup** sostituisce i dati di questo browser con quelli
  del file, dopo averti chiesto conferma.

IRIS ti ricorda di fare un backup in tre casi:

- la prima volta che inserisci dati veri;
- quando l'ultimo backup ha più di 14 giorni;
- quando ci sono diverse modifiche non salvate.

Per provare un ripristino senza rischi, aprilo in una finestra in incognito:
ha un archivio separato.

## Aggiornare IRIS

1. **Esporta un backup**, per sicurezza.
2. **Scarica la nuova versione** e sostituisci la vecchia cartella. Con Git
   basta `git pull`.
3. **Avvia `Avvia IRIS.bat`.** IRIS si aggiorna da sola e riapre lo stesso
   indirizzo, con i tuoi dati.

## Problemi frequenti

**Compare «IRIS ha bisogno di Node.js».**
Installa Node.js LTS da [nodejs.org](https://nodejs.org) e riavvia IRIS.

**Compare «L'installazione dei componenti non è riuscita».**
Controlla la connessione e riprova. Se il problema resta, cancella la cartella
`node_modules` dentro IRIS e riavviala.

**Compare «L'indirizzo di IRIS è occupato da un altro programma».**
Un altro programma usa la porta 3737: chiudilo e riavvia IRIS. IRIS non cambia
porta da sola, perché con un indirizzo diverso vedresti un archivio vuoto.
Se devi proprio cambiarla:

1. esporta un backup;
2. scrivi il nuovo numero di porta nel file `.iris-local\port.txt`;
3. riavvia IRIS e ripristina il backup.

**Il browser non si apre.**
Apri tu http://127.0.0.1:3737 mentre la finestra nera è aperta.

**L'archivio sembra vuoto.**
Controlla di usare lo stesso browser, non in incognito, e l'indirizzo
http://127.0.0.1:3737. Se il browser ha cancellato i dati del sito,
ripristina l'ultimo backup.

**Ho dimenticato il PIN.**
Il PIN non si recupera. Cancella i dati del sito 127.0.0.1:3737 dalle
impostazioni del browser, crea un nuovo PIN e ripristina un backup.

## Disinstallare

1. Esporta un backup, se vuoi conservare i dati.
2. Cancella la cartella di IRIS.
3. Per cancellare anche i dati, eliminali dalle impostazioni del browser. Su
   Chrome: *Impostazioni › Privacy e sicurezza › Impostazioni sito ›
   Visualizza autorizzazioni e dati memorizzati*, poi cerca `127.0.0.1`.

## Privacy e sicurezza

- **Nessun account, nessun cloud, nessuna analisi d'uso.** IRIS non invia i
  tuoi dati da nessuna parte e la telemetria di Next.js è disattivata.
- **I dati non sono cifrati.** Il PIN blocca lo schermo di IRIS, ma l'archivio
  è salvato in chiaro nel browser. Chi può usare il tuo computer e il tuo
  browser può leggerlo con gli strumenti per sviluppatori. IRIS non è una
  cassaforte.
- **Il PIN non è un account e non si recupera.** Se lo dimentichi, riparti da
  zero e ripristini un backup.
- **Il salvataggio nel browser non è una garanzia.** L'archivio si perde se
  cancelli i dati di navigazione, reinstalli il browser o cambi computer.
  IRIS chiede al browser di conservare i dati in modo persistente e ti ricorda
  di esportare un backup.
- **Il piccolo server di IRIS risponde solo a questo computer** (127.0.0.1).
  Non è raggiungibile dalla rete e serve soltanto i file dell'applicazione.
- **Non servono permessi di amministratore** per avviare IRIS. Lo script non
  modifica nulla fuori dalla sua cartella, a parte la cache di npm nel tuo
  profilo utente.

## Per sviluppatori

Servono Node.js 20.9 o successivo e npm.

```bash
npm start           # come Avvia IRIS.bat: installa, prepara, apre il browser
npm run dev         # server di sviluppo
npm run build       # sito statico in out/
```

Il launcher (`scripts/iris.mjs`) svolge quattro compiti:

- esegue `npm ci` solo quando `package-lock.json` cambia;
- ricostruisce il sito statico solo quando cambia il codice;
- serve `out/` su 127.0.0.1;
- apre il browser.

La porta scelta al primo avvio è salvata in `.iris-local/port.txt`. Il
launcher non la cambia da solo, perché IndexedDB lega l'archivio all'origine.

Opzioni del launcher:

- `--port <n>` usa quella porta senza salvarla;
- `--no-open` non apre il browser;
- `--rebuild` prepara di nuovo IRIS.

Controlli:

```bash
npm run lint
npx tsc --noEmit
npm test                          # Vitest (jsdom, fake-indexeddb)
npx playwright install chromium   # solo la prima volta
npm run test:e2e                  # Playwright, sul sito servito dal launcher
```

Tecnologie: Next.js (App Router, export statico), React, TypeScript, Dexie
(IndexedDB), Zod, Recharts, Radix, lucide-react. I suoni sono sintetizzati con
la Web Audio API. Il PIN è salvato come hash PBKDF2, mai in chiaro; la
sessione sbloccata vive in `sessionStorage`.

## English summary

- **Requirements.** Windows 10 or 11 and Node.js LTS (20.9 or later). macOS
  and Linux work through `npm start`.
- **Install.** Download the ZIP (*Code › Download ZIP*), extract it and
  double-click `Avvia IRIS.bat`. The first start installs and builds IRIS,
  which takes a few minutes.
- **Use.** IRIS opens at http://127.0.0.1:3737. Keep the console window open
  while you use it, and close the window to stop IRIS.
- **Data.** The archive lives in the browser and depends on the exact address.
  Use the same browser and address every time; closing IRIS deletes nothing.
- **Security.** The PIN locks the interface but does not encrypt the data.
  Export backups from *Settings › Data*.
- **Updates.** Export a backup, replace the folder (or run `git pull`) and
  start IRIS again.
- **Developers.** `npm run lint`, `npx tsc --noEmit`, `npm test`,
  `npm run test:e2e`.
