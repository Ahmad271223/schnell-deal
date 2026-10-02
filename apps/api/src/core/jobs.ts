import os from 'node:os';
import { sql } from 'drizzle-orm';
import { db, schema, type DbOrTx } from './db/client';

/**
 * Persistente Job-Queue in Postgres (Tabelle `jobs`).
 *
 * - Jobs werden in derselben Transaktion wie die fachliche Änderung eingereiht → kein Job geht verloren.
 * - Worker holen Jobs mit `FOR UPDATE SKIP LOCKED` → mehrere Worker parallel möglich.
 * - Reihenfolge nach Priorität, dann Fälligkeit: Ein Rückstau an E-Mails verzögert keine Deal-PDFs oder Fotos.
 * - Fehlschläge: exponentielles Backoff, nach `maxAttempts` Status FAILED + Admin-Benachrichtigung.
 * - Abgestürzte Worker: hängende RUNNING-Jobs werden nach 5 Minuten wieder freigegeben.
 */

export type JobType = 'image.process' | 'pdf.deal' | 'email.send' | 'push.send';

/** Abarbeitungsreihenfolge (kleinere Zahl zuerst): Deal-Dokumente und Fotos warten nie hinter Benachrichtigungen. */
export const JOB_PRIORITY: Record<JobType, number> = { 'pdf.deal': 10, 'image.process': 20, 'push.send': 50, 'email.send': 60 };

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  dedupeKey?: string;
}

export async function enqueue(tx: DbOrTx, type: JobType, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<void> {
  await tx
    .insert(schema.jobs)
    .values({
      type,
      payload,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 5,
      priority: JOB_PRIORITY[type],
      dedupeKey: opts.dedupeKey ?? null,
    })
    .onConflictDoNothing();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobHandler = (payload: any, job: { id: number; attempts: number }) => Promise<void>;

export interface WorkerOptions {
  handlers: Partial<Record<JobType, JobHandler>>;
  concurrency?: number;
  pollMs?: number;
  onFailed?: (job: { id: number; type: string; error: string }) => Promise<void>;
}

interface ClaimedJob {
  id: number;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

export class JobWorker {
  private running = false;
  private active = 0;
  private timer: NodeJS.Timeout | null = null;
  private reaperTimer: NodeJS.Timeout | null = null;
  private readonly workerId = `${os.hostname()}:${process.pid}`;
  private idleResolvers: Array<() => void> = [];

  constructor(private readonly opts: WorkerOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
    this.reaperTimer = setInterval(() => void this.reap(), 60_000);
    void this.reap();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.reaperTimer) clearInterval(this.reaperTimer);
    await this.idle();
  }

  idle(): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise((r) => this.idleResolvers.push(r));
  }

  /** Verarbeitet alle fälligen Jobs synchron (für Tests und Skripte). */
  async drain(maxRounds = 200): Promise<number> {
    let processed = 0;
    for (let i = 0; i < maxRounds; i++) {
      const job = await this.claim();
      if (!job) break;
      await this.execute(job);
      processed++;
    }
    return processed;
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  /** Nach jedem fertigen Job sofort weiter abholen, statt bei Rückstau auf das nächste Abfrageintervall zu warten. */
  private wake(): void {
    if (!this.running) return;
    if (this.ticking) this.wakeRequested = true;
    else this.schedule(0);
  }

  private ticking = false;
  private wakeRequested = false;

  private async tick(): Promise<void> {
    if (this.ticking) {
      this.wakeRequested = true;
      return;
    }
    this.ticking = true;
    const concurrency = this.opts.concurrency ?? 4;
    try {
      while (this.running && this.active < concurrency) {
        const job = await this.claim();
        if (!job) break;
        this.active++;
        void this.execute(job)
          .catch((err) => console.error(`[jobs] Statusaktualisierung für Job ${job.id} fehlgeschlagen – wird vom Reaper erneut eingeplant`, err))
          .finally(() => {
            this.active--;
            if (this.active === 0) this.idleResolvers.splice(0).forEach((r) => r());
            this.wake();
          });
      }
    } catch (err) {
      console.error('[jobs] Fehler beim Abholen', (err as Error).message);
    }
    this.ticking = false;
    if (this.wakeRequested) {
      this.wakeRequested = false;
      this.schedule(0);
    } else {
      this.schedule(this.opts.pollMs ?? 500);
    }
  }

  private async claim(): Promise<ClaimedJob | null> {
    const types = Object.keys(this.opts.handlers);
    if (types.length === 0) return null;
    const res = await db.execute<{ id: number; type: string; payload: unknown; attempts: number; max_attempts: number }>(sql`
      UPDATE jobs SET status = 'RUNNING', locked_at = now(), locked_by = ${this.workerId}, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'PENDING' AND run_at <= now() AND type IN (${sql.join(
          types.map((t) => sql`${t}`),
          sql`, `,
        )})
        ORDER BY priority, run_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, payload, attempts, max_attempts`);
    const row = res.rows[0];
    if (!row) return null;
    return { id: Number(row.id), type: row.type, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts };
  }

  private async execute(job: ClaimedJob): Promise<void> {
    const handler = this.opts.handlers[job.type as JobType];
    try {
      if (!handler) throw new Error(`Kein Handler für Job-Typ ${job.type}`);
      await handler(job.payload, { id: job.id, attempts: job.attempts });
      await db.execute(sql`UPDATE jobs SET status = 'DONE', finished_at = now(), last_error = NULL WHERE id = ${job.id}`);
    } catch (err) {
      const message = (err as Error).stack ?? String(err);
      const final = job.attempts >= job.maxAttempts;
      const backoffSec = Math.min(3600, 5 * 2 ** (job.attempts - 1));
      const nextStatus = final ? 'FAILED' : 'PENDING';
      await db.execute(sql`
        UPDATE jobs SET
          status = ${nextStatus}::job_status,
          last_error = ${message.slice(0, 4000)},
          run_at = now() + make_interval(secs => ${backoffSec}),
          finished_at = ${final ? sql`now()` : sql`NULL`}
        WHERE id = ${job.id}`);
      console.error(`[jobs] Job ${job.id} (${job.type}) fehlgeschlagen (Versuch ${job.attempts}/${job.maxAttempts}):`, (err as Error).message);
      if (final && this.opts.onFailed) {
        await this.opts
          .onFailed({ id: job.id, type: job.type, error: (err as Error).message })
          .catch((e) => console.error('[jobs] onFailed-Handler fehlgeschlagen', e));
      }
    }
  }

  private async reap(): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE jobs SET status = 'PENDING', locked_at = NULL, locked_by = NULL,
          last_error = 'Worker-Abbruch erkannt, erneut eingeplant'
        WHERE status = 'RUNNING' AND locked_at < now() - interval '5 minutes'`);
    } catch (err) {
      console.error('[jobs] Reaper-Fehler', (err as Error).message);
    }
  }
}

export async function retryJob(id: number): Promise<boolean> {
  const res = await db.execute(
    sql`UPDATE jobs SET status = 'PENDING', run_at = now(), attempts = 0 WHERE id = ${id} AND status = 'FAILED'`,
  );
  return (res.rowCount ?? 0) > 0;
}
