/*
 * AVVIA IRIS. From a fresh download to IRIS open in the browser, in one
 * command (`Avvia IRIS.bat` on Windows, `npm start` elsewhere):
 *
 *   1. checks Node.js;
 *   2. installs the dependencies, only when they are missing or changed;
 *   3. builds IRIS (a static site in out/), only when the code changed;
 *   4. serves out/ on 127.0.0.1 — this computer only, never the network —
 *      and opens the browser.
 *
 * THE ADDRESS NEVER CHANGES. The browser binds IRIS's archive (IndexedDB) to
 * the exact address, port included: served on another port, IRIS would open
 * an empty archive and look like it lost everything. So the port is chosen
 * once (3737, or the first free one after it), saved in .iris-local/port.txt,
 * and reused. If another program takes it later, IRIS stops and says so
 * instead of quietly moving.
 *
 * Nothing here needs administrator rights, and nothing is sent anywhere:
 * Next.js telemetry is off, and the server only answers this computer.
 *
 * Options (for development and tests): --port <n> uses that port without
 * saving it, --no-open does not open the browser, --rebuild builds again.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, get } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localDir = path.join(root, ".iris-local");
const portFile = path.join(localDir, "port.txt");
const buildStampFile = path.join(localDir, "build-stamp.txt");
const lockFile = path.join(localDir, "preparing.lock");
const installStampFile = path.join(root, "node_modules", ".iris-install-stamp");
const outDir = path.join(root, "out");

const host = "127.0.0.1";
const defaultPort = 3737;
const portsToTry = 20;
const minimumNode = [20, 9, 0];

const childEnv = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
  npm_config_audit: "false",
};

// ─── Messages ────────────────────────────────────────────────────────────────

function say(line = "") {
  process.stdout.write(`${line}\n`);
}

function step(line) {
  say();
  say(`  » ${line}`);
}

class Stop extends Error {}

/** Ends the launch with an explanation; the .bat keeps the window open on it. */
function stop(...lines) {
  say();
  say("  ✖ IRIS non è partita.");
  say();
  for (const line of lines) say(`    ${line}`);
  throw new Stop();
}

// ─── Options ─────────────────────────────────────────────────────────────────

function readOptions(argv) {
  const options = { port: null, open: true, rebuild: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-open") options.open = false;
    else if (argument === "--rebuild") options.rebuild = true;
    else if (argument === "--port") {
      const port = Number(argv[index + 1]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) stop(`--port vuole un numero tra 1024 e 65535.`);
      options.port = port;
      index += 1;
    } else stop(`Opzione sconosciuta: ${argument}`);
  }
  return options;
}

// ─── 1. Node.js ──────────────────────────────────────────────────────────────

function checkNode() {
  const current = process.versions.node.split(".").map(Number);
  for (let index = 0; index < minimumNode.length; index += 1) {
    if (current[index] > minimumNode[index]) return;
    if (current[index] < minimumNode[index]) {
      stop(
        `Questa versione di Node.js (${process.versions.node}) è troppo vecchia: serve la ${minimumNode.join(".")} o successiva.`,
        "Installa la versione LTS da https://nodejs.org e riavvia IRIS.",
      );
    }
  }
}

// ─── One preparation at a time ───────────────────────────────────────────────

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** A second double-click while the first is still installing must not install over it. */
function takePreparationLock() {
  mkdirSync(localDir, { recursive: true });
  if (existsSync(lockFile)) {
    const pid = Number(readFileSync(lockFile, "utf8"));
    if (Number.isInteger(pid) && pid !== process.pid && isRunning(pid)) {
      stop(
        "IRIS si sta già preparando in un'altra finestra.",
        "Aspetta che finisca: si aprirà da sola nel browser.",
      );
    }
  }
  writeFileSync(lockFile, String(process.pid));
  return () => rmSync(lockFile, { force: true });
}

// ─── 2. Dependencies ─────────────────────────────────────────────────────────

function hashOf(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(path.relative(root, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(full) : [full];
    });
}

function readText(file) {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function run(command, args, { shell = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, env: childEnv, stdio: "inherit", shell });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function installDependencies() {
  const lock = path.join(root, "package-lock.json");
  const wanted = hashOf([path.join(root, "package.json"), lock]);
  const installed = existsSync(path.join(root, "node_modules", "next", "package.json"));
  if (installed && readText(installStampFile) === wanted) return;

  step(installed ? "Aggiorno i componenti di IRIS…" : "Installo i componenti di IRIS (solo la prima volta, qualche minuto)…");
  // One fixed command string: no user input reaches the shell.
  const code = await run("npm ci --no-audit --no-fund --loglevel=error", [], { shell: true });
  if (code !== 0) {
    stop(
      "L'installazione dei componenti non è riuscita.",
      "Controlla la connessione a internet e riprova.",
      "Se il problema resta, cancella la cartella node_modules e riavvia IRIS.",
    );
  }
  writeFileSync(installStampFile, wanted);
}

// ─── 3. Build ────────────────────────────────────────────────────────────────

function buildStamp() {
  const inputs = [
    "package-lock.json",
    "next.config.ts",
    "tsconfig.json",
    "postcss.config.mjs",
  ].map((file) => path.join(root, file));
  const sources = filesUnder(path.join(root, "src")).filter((file) => !/\.test\.tsx?$/.test(file));
  return `${hashOf([...inputs, ...sources])}:${process.env.NEXT_PUBLIC_IRIS_BETA ?? ""}`;
}

async function build(force) {
  const wanted = buildStamp();
  const built = existsSync(path.join(outDir, "index.html"));
  if (!force && built && readText(buildStampFile) === wanted) return;

  step(built ? "Aggiorno IRIS dopo le modifiche…" : "Preparo IRIS (solo la prima volta, circa un minuto)…");
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const code = await run(process.execPath, [next, "build"]);
  if (code !== 0 || !existsSync(path.join(outDir, "index.html"))) {
    stop(
      "La preparazione di IRIS non è riuscita (vedi i messaggi qui sopra).",
      "Se hai modificato dei file, ripristinali; altrimenti scarica di nuovo IRIS.",
    );
  }
  writeFileSync(buildStampFile, wanted);
}

// ─── 4. The port ─────────────────────────────────────────────────────────────

/** What answers on the port: IRIS (already open), another program, or nothing. */
function probe(port) {
  return new Promise((resolve) => {
    const request = get({ host, port, path: "/__iris", timeout: 1500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length < 1000) body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body).app === "iris" ? "iris" : "other");
        } catch {
          resolve("other");
        }
      });
    });
    request.on("timeout", () => {
      request.destroy();
      resolve("other");
    });
    request.on("error", () => {
      // Nothing speaks HTTP there; something may still hold the port.
      const tester = createServer();
      tester.once("error", () => resolve("other"));
      tester.listen(port, host, () => tester.close(() => resolve("free")));
    });
  });
}

function savedPort() {
  const port = Number(readText(portFile));
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

const address = (port) => `http://${host}:${port}/`;

/** The port to serve on, or null when IRIS is already running there. */
async function choosePort(options) {
  if (options.port !== null) {
    const state = await probe(options.port);
    if (state !== "free") stop(`La porta ${options.port} è già occupata.`);
    return { port: options.port, running: false };
  }

  const saved = savedPort();
  if (saved !== null) {
    const state = await probe(saved);
    if (state === "free") return { port: saved, running: false };
    if (state === "iris") return { port: saved, running: true };
    stop(
      `L'indirizzo di IRIS (${address(saved)}) è occupato da un altro programma.`,
      "IRIS usa sempre lo stesso indirizzo perché il browser lega i tuoi dati a",
      "quell'indirizzo: cambiarlo aprirebbe un archivio vuoto.",
      "",
      "Chiudi il programma che usa la porta e riavvia IRIS.",
      "Se devi proprio cambiarla: esporta un backup (Impostazioni › Dati), scrivi",
      `il nuovo numero in ${path.relative(root, portFile)} e ripristina il backup.`,
    );
  }

  for (let port = defaultPort; port < defaultPort + portsToTry; port += 1) {
    const state = await probe(port);
    if (state === "free") return { port, running: false, save: true };
    if (state === "iris") return { port, running: true, save: true };
  }
  stop(`Nessuna porta libera tra ${defaultPort} e ${defaultPort + portsToTry - 1}.`, "Chiudi qualche programma e riprova.");
}

// ─── 5. Serving out/ ─────────────────────────────────────────────────────────

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// IRIS loads nothing from other origins: fonts are bundled, no analytics, no
// API. Next's inline bootstrap and the theme script need 'unsafe-inline'.
const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function fileFor(pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (relative.includes("\0")) return null;
  const full = path.resolve(outDir, `.${path.posix.normalize(relative)}`);
  if (full !== outDir && !full.startsWith(outDir + path.sep)) return null;
  for (const candidate of [full, path.join(full, "index.html"), `${full}.html`]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next form
    }
  }
  return null;
}

function serve(port) {
  const origin = `${host}:${port}`;
  const server = createServer((request, response) => {
    // Another name for this computer is another archive: send it to the one address.
    if (request.headers.host !== origin) {
      const [name] = (request.headers.host ?? "").split(":");
      if (name === "localhost") {
        response.writeHead(308, { Location: `http://${origin}${request.url}` }).end();
      } else {
        response.writeHead(421).end();
      }
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }

    const { pathname } = new URL(request.url ?? "/", `http://${origin}`);
    if (pathname === "/__iris") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ app: "iris" }));
      return;
    }

    const found = fileFor(pathname);
    const file = found ?? path.join(outDir, "404.html");
    const status = found ? 200 : 404;
    if (!existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(status, {
      ...securityHeaders,
      "Content-Type": contentTypes[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(file).on("error", () => response.destroy()).pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

// ─── 6. The browser ──────────────────────────────────────────────────────────

function openBrowser(url) {
  const [command, args, extra] =
    process.platform === "win32"
      ? ["cmd.exe", ["/c", "start", '""', url], { windowsVerbatimArguments: true }]
      : process.platform === "darwin"
        ? ["open", [url], {}]
        : ["xdg-open", [url], {}];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true, ...extra });
    child.on("error", () => say(`    (Il browser non si è aperto da solo: apri ${url})`));
    child.unref();
  } catch {
    say(`    (Il browser non si è aperto da solo: apri ${url})`);
  }
}

// ─── Launch ──────────────────────────────────────────────────────────────────

async function main() {
  const options = readOptions(process.argv.slice(2));
  say();
  say("  IRIS");
  checkNode();

  const release = takePreparationLock();
  try {
    await installDependencies();
    await build(options.rebuild);
  } finally {
    release();
  }

  const choice = await choosePort(options);
  const url = address(choice.port);
  if (choice.save) writeFileSync(portFile, String(choice.port));

  if (choice.running) {
    step("IRIS è già accesa: la apro nel browser.");
    if (options.open) openBrowser(url);
    say(`    ${url}`);
    say();
    return;
  }

  let server;
  try {
    server = await serve(choice.port);
  } catch {
    stop(`Non riesco ad aprire ${url}: la porta è stata appena occupata. Riprova.`);
  }

  say();
  say(`  ✔ IRIS è pronta: ${url}`);
  say();
  say("    · Lascia aperta questa finestra mentre usi IRIS; per spegnerla, chiudila.");
  say("    · I tuoi dati restano nel browser, non in questa cartella: chiudere la");
  say("      finestra o aggiornare IRIS non li cancella.");
  say("    · Il PIN blocca lo schermo ma NON cifra i dati. Esporta spesso un backup");
  say("      da Impostazioni › Dati: è l'unica copia che sopravvive se il browser");
  say("      cancella i dati del sito.");
  say();
  if (options.open) openBrowser(url);

  const shutDown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutDown);
  process.on("SIGTERM", shutDown);
}

main().catch((error) => {
  if (!(error instanceof Stop)) {
    say();
    say("  ✖ IRIS si è fermata per un errore inatteso:");
    say(`    ${error?.stack ?? error}`);
  }
  say();
  process.exitCode = 1;
});
