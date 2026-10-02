import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Statische Regeln für den Routen-Code. Diese Fehler zeigen sich in Integrationstests nur zufällig (Timing),
 * deshalb werden sie hier am Quelltext geprüft.
 */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

/** Rumpf jedes `.transaction(async (tx) => { … })`-Callbacks, ermittelt über Klammerzählung. */
function transactionBodies(src: string): { body: string; offset: number }[] {
  const out: { body: string; offset: number }[] = [];
  const re = /\.transaction\(\s*async\s*\(\s*\w+\s*\)\s*=>\s*\{/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    out.push({ body: src.slice(start, i), offset: start });
  }
  return out;
}

describe('Architekturregeln', () => {
  it('sendet keine HTTP-Antwort aus einer offenen Datenbanktransaktion', () => {
    // Sonst erhält der Client die Antwort vor dem Commit; eine sofortige Folgeanfrage (z. B. FIN nach „Fahrzeug anlegen“
    // aus der Offline-Warteschlange) sieht die neuen Daten noch nicht und scheitert mit 404.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const { body, offset } of transactionBodies(src)) {
        const re = /reply\s*(\.(status|code)\(\s*\d+\s*\))?\s*\.send\(|reply\.redirect\(/g;
        for (let m = re.exec(body); m; m = re.exec(body)) {
          offenders.push(`${path.relative(SRC, file)}:${src.slice(0, offset + m.index).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('findet die Prüfung selbst (Gegenprobe mit einem Beispiel)', () => {
    const sample = "await db.transaction(async (tx) => {\n  if (x) { return reply.status(201).send({ a: 1 }); }\n});";
    const bodies = transactionBodies(sample);
    expect(bodies).toHaveLength(1);
    expect(/reply\s*(\.(status|code)\(\s*\d+\s*\))?\s*\.send\(/.test(bodies[0]!.body)).toBe(true);
  });
});
