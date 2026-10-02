import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { clamdInstream } from '../src/core/storage';

/**
 * clamd-INSTREAM-Client gegen einen nachgebauten clamd-Dienst:
 * Protokoll (Befehl, Längenpräfixe, Abschluss-Chunk) und Fail-closed-Verhalten bei allem außer „stream: OK“.
 */
type Reply = string | null; // null = Verbindung ohne Antwort schließen

const servers: net.Server[] = [];
const connections = new Set<net.Socket>();

afterEach(async () => {
  for (const s of connections) s.destroy();
  connections.clear();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

async function listen(onConnection: (socket: net.Socket) => void): Promise<number> {
  const server = net.createServer((socket) => {
    connections.add(socket);
    socket.on('error', () => undefined);
    onConnection(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return (server.address() as net.AddressInfo).port;
}

async function fakeClamd(reply: Reply): Promise<{ port: number; received: Promise<{ command: string; payload: Buffer }> }> {
  let deliver!: (v: { command: string; payload: Buffer }) => void;
  const received = new Promise<{ command: string; payload: Buffer }>((resolve) => (deliver = resolve));
  const port = await listen((socket) => {
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const commandEnd = buf.indexOf(0);
      if (commandEnd < 0) return;
      const chunks: Buffer[] = [];
      let offset = commandEnd + 1;
      while (offset + 4 <= buf.length) {
        const len = buf.readUInt32BE(offset);
        if (len === 0) {
          deliver({ command: buf.subarray(0, commandEnd).toString(), payload: Buffer.concat(chunks) });
          if (reply === null) socket.end();
          else socket.end(reply);
          return;
        }
        if (offset + 4 + len > buf.length) return; // auf weitere Daten warten
        chunks.push(buf.subarray(offset + 4, offset + 4 + len));
        offset += 4 + len;
      }
    });
  });
  return { port, received };
}

describe('clamd-INSTREAM-Client', () => {
  const file = Buffer.alloc(200 * 1024, 7); // größer als ein 64-KB-Chunk

  it('überträgt die Datei vollständig im INSTREAM-Protokoll und gibt nur bei „stream: OK“ frei', async () => {
    const clamd = await fakeClamd('stream: OK\0');
    await expect(clamdInstream(file, '127.0.0.1', clamd.port)).resolves.toEqual({ infected: false });
    const { command, payload } = await clamd.received;
    expect(command).toBe('zINSTREAM');
    expect(payload.equals(file)).toBe(true);
  });

  it('meldet einen Fund mit Signaturname', async () => {
    const clamd = await fakeClamd('stream: Eicar-Test-Signature FOUND\0');
    await expect(clamdInstream(file, '127.0.0.1', clamd.port)).resolves.toEqual({ infected: true, signature: 'Eicar-Test-Signature' });
  });

  it.each<[string, Reply]>([
    ['Fehlerantwort des Scanners', 'INSTREAM size limit exceeded. ERROR\0'],
    ['unbekannter Antwort', 'stream: unexpected\0'],
    ['Verbindungsende ohne Antwort', null],
  ])('blockiert bei %s (fail closed)', async (_label, reply) => {
    const clamd = await fakeClamd(reply);
    await expect(clamdInstream(file, '127.0.0.1', clamd.port)).rejects.toMatchObject({ statusCode: 503, code: 'SCANNER_UNAVAILABLE' });
  });

  it('blockiert, wenn der Scanner nicht erreichbar ist', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(clamdInstream(file, '127.0.0.1', port)).rejects.toMatchObject({ statusCode: 503, code: 'SCANNER_UNAVAILABLE' });
  });

  it('blockiert bei Zeitüberschreitung', async () => {
    const port = await listen(() => undefined); // nimmt an, antwortet aber nie
    await expect(clamdInstream(file, '127.0.0.1', port, 300)).rejects.toMatchObject({ statusCode: 503, code: 'SCANNER_UNAVAILABLE' });
  });
});
