// Startet einen Server-Prozess für die E2E-Tests, protokolliert, wann und wie er endet, und startet ihn nach einem
// unerwarteten Ende neu (höchstens MAX_RESTARTS Mal). Hintergrund: In der lokalen Windows-Testumgebung wurden
// Serverprozesse vereinzelt ohne Fehlermeldung von außen beendet (kein Absturzeintrag im Ereignisprotokoll).
// Im Betrieb übernimmt das die Neustart-Regel der Container (restart: unless-stopped).
import { spawn } from 'node:child_process';

const MAX_RESTARTS = 3;
const [name, ...command] = process.argv.slice(2);
if (!name || command.length === 0) {
  console.error('Aufruf: node scripts/serve.mjs <name> <befehl ...>');
  process.exit(2);
}

const stamp = () => new Date().toISOString();
let child = null;
let restarts = 0;
let stopping = false;

function start() {
  const started = Date.now();
  child = spawn(command.join(' '), { shell: true, stdio: 'inherit', env: process.env });
  console.error(`[serve:${name}] gestartet (PID ${child.pid}, ${stamp()})`);
  child.on('exit', (code, signal) => {
    const seconds = Math.round((Date.now() - started) / 1000);
    if (stopping) {
      console.error(`[serve:${name}] beendet nach ${seconds} s: code=${code} signal=${signal}`);
      process.exit(code ?? 0);
    }
    console.error(`[serve:${name}] Prozess unerwartet beendet nach ${seconds} s: code=${code} signal=${signal} (${stamp()})`);
    if (restarts >= MAX_RESTARTS) {
      console.error(`[serve:${name}] zu viele Neustarts – gebe auf`);
      process.exit(code ?? 1);
    }
    restarts++;
    console.error(`[serve:${name}] Neustart ${restarts}/${MAX_RESTARTS} in 1 s`);
    setTimeout(start, 1000);
  });
  child.on('error', (err) => {
    console.error(`[serve:${name}] Start fehlgeschlagen: ${err.message}`);
    process.exit(1);
  });
}

// Beenden durch den Testlauf: Signal weiterreichen (unter Windows beendet Playwright den Prozessbaum selbst).
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  process.on(sig, () => {
    console.error(`[serve:${name}] ${sig} empfangen (${stamp()})`);
    stopping = true;
    if (process.platform !== 'win32') child?.kill(sig);
    else setTimeout(() => process.exit(0), 5000).unref();
  });
}

start();
