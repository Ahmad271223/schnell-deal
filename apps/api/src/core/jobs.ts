import crypto from 'node:crypto';
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
 * - Abgestürzte Worker: hängende RUNNING-Jobs werden nach 5 Minuten wieder freigegeben. Laufende Jobs senden dafür
 *   jede Minute ein Lebenszeichen (`locked_at`), damit lange Jobs nicht doppelt laufen.
 * - Sperr-Token: Jede Übernahme erhält ein eigenes Token in `locked_by`; Statusänderungen gelten nur, wenn das Token
 *   noch gilt. Ein Lauf, dessen Job zwischenzeitlich neu vergeben wurde, kann dessen Status nicht mehr überschreiben.
 * - Zwischenstand (`checkpoint`): Handler persistieren vor nicht wiederholbaren Nebenwirkungen (E-Mail, Push), was
 *   bereits erledigt ist; eine Wiederholung setzt dort an, statt doppelt zu senden.
 */

export type JobType = 'image.process' | 'pdf.deal' | 'email.send' | 'push.send';

/** Abarbeitungsreihenfolge (kleinere Zahl zuerst): Deal-Dokumente und Fotos warten nie hinter Benachrichtigungen. */
export const JOB_PRIORITY: Record<JobType, number> = { 'pdf.deal': 10, 'image.process': 20, 'push.send': 50, 'email.send': 60 };

/** Nach dieser Zeit ohne Lebenszeichen gilt ein RUNNING-Job als verwaist. */
export const STALE_AFTER_MS = 5 * 60_000;
const HEARTBEAT_MS = 60_000;

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

export interface JobContext {
  id: number;
  attempts: number;
  /** Zwischenstand des vorherigen Versuchs (null beim ersten Lauf). */
  checkpoint: Record<string, unknown> | null;
  /**
   * Zwischenstand sofort persistieren (eigene Transaktion), bevor eine nicht wiederholbare Nebenwirkung ausgelöst wird.
   * Wirft, wenn die Sperre inzwischen verloren ging: dann darf die Nebenwirkung nicht mehr ausgelöst werden.
   */
  saveCheckpoint: (data: Record<string, unknown>) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobHandler = (payload: any, job: JobContext) => Promise<void>;

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
  checkpoint: Record<string, unknown> | null;
  lockToken: string;
}

export class LockLostError extends Error {
  constructor(jobId: number) {
    super(`Job ${jobId}: Sperre verloren (vom Reaper neu vergeben), Lauf abgebrochen`);
  }
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
    const lockToken = `${this.workerId}#${crypto.randomUUID()}`;
    const res = await db.execute<{ id: number; type: string; payload: unknown; attempts: number; max_attempts: number; checkpoint: Record<string, unknown> | null }>(sql`
      UPDATE jobs SET status = 'RUNNING', locked_at = now(), locked_by = ${lockToken}, attempts = attempts + 1
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
      RETURNING id, type, payload, attempts, max_attempts, checkpoint`);
    const row = res.rows[0];
    if (!row) return null;
    return { id: Number(row.id), type: row.type, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts, checkpoint: row.checkpoint ?? null, lockToken };
  }

  /** Statusänderung nur, solange dieser Lauf die Sperre hält; sonst 0 Zeilen. */
  private async guardedUpdate(job: ClaimedJob, set: ReturnType<typeof sql>): Promise<boolean> {
    const res = await db.execute(sql`UPDATE jobs SET ${set} WHERE id = ${job.id} AND locked_by = ${job.lockToken} AND status = 'RUNNING'`);
    return (res.rowCount ?? 0) > 0;
  }

  private async execute(job: ClaimedJob): Promise<void> {
    const handler = this.opts.handlers[job.type as JobType];
    // Lebenszeichen, damit der Reaper lange Jobs (große Fotos, PDFs) nicht als verwaist einstuft.
    const heartbeat = setInterval(() => {
      void this.guardedUpdate(job, sql`locked_at = now()`).catch((err) => console.error(`[jobs] Lebenszeichen für Job ${job.id} fehlgeschlagen`, (err as Error).message));
    }, HEARTBEAT_MS);
    const ctx: JobContext = {
      id: job.id,
      attempts: job.attempts,
      checkpoint: job.checkpoint,
      saveCheckpoint: async (data) => {
        const ok = await this.guardedUpdate(job, sql`checkpoint = ${JSON.stringify(data)}::jsonb, locked_at = now()`);
        if (!ok) throw new LockLostError(job.id);
        job.checkpoint = data;
      },
    };
    try {
      if (!handler) throw new Error(`Kein Handler für Job-Typ ${job.type}`);
      await handler(job.payload, ctx);
      const ok = await this.guardedUpdate(job, sql`status = 'DONE', finished_at = now(), last_error = NULL`);
      if (!ok) console.warn(`[jobs] Job ${job.id} (${job.type}) wurde während der Ausführung neu vergeben; dieser Lauf ändert den Status nicht mehr.`);
    } catch (err) {
      const message = (err as Error).stack ?? String(err);
      const final = job.attempts >= job.maxAttempts;
      const backoffSec = Math.min(3600, 5 * 2 ** (job.attempts - 1));
      const nextStatus = final ? 'FAILED' : 'PENDING';
      const ok = await this.guardedUpdate(
        job,
        sql`status = ${nextStatus}::job_status,
          last_error = ${message.slice(0, 4000)},
          run_at = now() + make_interval(secs => ${backoffSec}),
          finished_at = ${final ? sql`now()` : sql`NULL`}`,
      );
      if (!ok) {
        console.warn(`[jobs] Job ${job.id} (${job.type}) scheiterte in einem Lauf, der die Sperre bereits verloren hatte: ${(err as Error).message}`);
        return;
      }
      console.error(`[jobs] Job ${job.id} (${job.type}) fehlgeschlagen (Versuch ${job.attempts}/${job.maxAttempts}):`, (err as Error).message);
      if (final && this.opts.onFailed) {
        await this.opts
          .onFailed({ id: job.id, type: job.type, error: (err as Error).message })
          .catch((e) => console.error('[jobs] onFailed-Handler fehlgeschlagen', e));
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async reap(): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE jobs SET status = 'PENDING', locked_at = NULL, locked_by = NULL,
          last_error = 'Worker-Abbruch erkannt (kein Lebenszeichen), erneut eingeplant'
        WHERE status = 'RUNNING' AND locked_at < now() - make_interval(secs => ${STALE_AFTER_MS / 1000})`);
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
