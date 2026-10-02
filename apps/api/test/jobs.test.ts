import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { JOB_PRIORITY, JobWorker, LockLostError, enqueue } from '../src/core/jobs';
import { db, schema } from '../src/core/db/client';
import { uniq } from './helpers';

/** Job-Queue: Geschäftskritische Jobs dürfen nicht hinter einem Rückstau an Benachrichtigungen warten. */
describe('Job-Queue', () => {
  it('priorisiert Deal-PDFs und Bildverarbeitung vor Benachrichtigungen', () => {
    expect(JOB_PRIORITY['pdf.deal']).toBeLessThan(JOB_PRIORITY['email.send']);
    expect(JOB_PRIORITY['pdf.deal']).toBeLessThan(JOB_PRIORITY['push.send']);
    expect(JOB_PRIORITY['image.process']).toBeLessThan(JOB_PRIORITY['email.send']);
    expect(JOB_PRIORITY['image.process']).toBeLessThan(JOB_PRIORITY['push.send']);
  });

  it('speichert die Priorität beim Einreihen', async () => {
    const key = uniq('prio');
    // Fälligkeit in der Zukunft: kein anderer Test arbeitet diesen Job ab.
    await enqueue(db, 'email.send', { to: 'prio@test.local', subject: 'Test', text: 'Test' }, { dedupeKey: key, runAt: new Date(Date.now() + 3_600_000) });
    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, key));
    expect(row!.priority).toBe(JOB_PRIORITY['email.send']);
    await db.update(schema.jobs).set({ status: 'DONE' }).where(eq(schema.jobs.id, row!.id));
  });

  it('arbeitet höher priorisierte Jobs zuerst ab, auch wenn sie später eingereiht wurden', async () => {
    // Eigene Job-Typen, damit dieser Worker keine Jobs anderer Tests übernimmt.
    const low = uniq('test.low');
    const high = uniq('test.high');
    const first = await db
      .insert(schema.jobs)
      .values([
        { type: low, payload: { n: 1 }, priority: JOB_PRIORITY['email.send'] },
        { type: low, payload: { n: 2 }, priority: JOB_PRIORITY['email.send'] },
      ])
      .returning({ id: schema.jobs.id });
    const later = await db.insert(schema.jobs).values({ type: high, payload: { n: 3 }, priority: JOB_PRIORITY['pdf.deal'] }).returning({ id: schema.jobs.id });

    const order: string[] = [];
    const worker = new JobWorker({
      handlers: {
        [low]: async () => void order.push('low'),
        [high]: async () => void order.push('high'),
      } as never,
    });
    expect(await worker.drain()).toBe(3);
    expect(order).toEqual(['high', 'low', 'low']);

    const ids = [...first, ...later].map((r) => r.id);
    const rows = await db.select({ status: schema.jobs.status }).from(schema.jobs).where(inArray(schema.jobs.id, ids));
    expect(rows.map((r) => r.status)).toEqual(['DONE', 'DONE', 'DONE']);
  });

  it('arbeitet einen Rückstau ohne Wartezeit zwischen den Jobs ab', async () => {
    const type = uniq('test.backlog');
    await db.insert(schema.jobs).values(Array.from({ length: 12 }, (_, n) => ({ type, payload: { n }, priority: JOB_PRIORITY['email.send'] })));
    let done = 0;
    const worker = new JobWorker({
      concurrency: 2,
      pollMs: 60_000, // bewusst langes Abfrageintervall: der Fortschritt darf nicht davon abhängen
      handlers: {
        [type]: async () => {
          await new Promise((r) => setTimeout(r, 5));
          done++;
        },
      } as never,
    });
    const started = Date.now();
    worker.start();
    while (done < 12 && Date.now() - started < 10_000) await new Promise((r) => setTimeout(r, 20));
    await worker.stop();
    expect(done).toBe(12);
  });
});

describe('Job-Queue: Sperren und Zwischenstände', () => {
  it('ein Lauf, dessen Job der Reaper neu vergeben hat, kann den Status nicht mehr überschreiben', async () => {
    const type = uniq('test.lock');
    const [row] = await db.insert(schema.jobs).values({ type, payload: {}, priority: 10 }).returning({ id: schema.jobs.id });
    let runs = 0;
    const worker = new JobWorker({
      handlers: {
        [type]: async () => {
          runs++;
          // Simuliert den Reaper: Job gilt als verwaist und wird freigegeben, während dieser Lauf noch arbeitet.
          if (runs === 1) await db.execute(sql`UPDATE jobs SET status = 'PENDING', locked_by = NULL, locked_at = NULL WHERE id = ${row!.id}`);
        },
      } as never,
    });
    expect(await worker.drain(1)).toBe(1);
    const [afterFirst] = await db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, row!.id));
    // Der erste Lauf darf den freigegebenen Job nicht auf DONE setzen; der zweite Lauf erledigt ihn.
    expect(afterFirst!.status).toBe('PENDING');
    expect(await worker.drain(1)).toBe(1);
    const [afterSecond] = await db.select({ status: schema.jobs.status, attempts: schema.jobs.attempts }).from(schema.jobs).where(eq(schema.jobs.id, row!.id));
    expect(afterSecond).toMatchObject({ status: 'DONE', attempts: 2 });
  });

  it('übergibt den Zwischenstand an die Wiederholung und bricht ab, wenn die Sperre beim Speichern verloren ist', async () => {
    const type = uniq('test.checkpoint');
    const [row] = await db.insert(schema.jobs).values({ type, payload: {}, priority: 10, maxAttempts: 3 }).returning({ id: schema.jobs.id });
    const seen: unknown[] = [];
    let lockLost: unknown = null;
    const worker = new JobWorker({
      handlers: {
        [type]: async (_payload: unknown, job: { attempts: number; checkpoint: unknown; saveCheckpoint: (d: Record<string, unknown>) => Promise<void> }) => {
          seen.push(job.checkpoint);
          if (job.attempts === 1) {
            await job.saveCheckpoint({ sent: ['a'] });
            throw new Error('Abbruch nach dem ersten Empfänger');
          }
          if (job.attempts === 2) {
            await db.execute(sql`UPDATE jobs SET locked_by = 'jemand-anderes' WHERE id = ${row!.id}`);
            await job.saveCheckpoint({ sent: ['a', 'b'] }).catch((e) => (lockLost = e));
            throw new Error('weiter nach verlorener Sperre');
          }
        },
      } as never,
    });
    expect(await worker.drain(1)).toBe(1);
    await db.execute(sql`UPDATE jobs SET run_at = now() WHERE id = ${row!.id}`);
    expect(await worker.drain(1)).toBe(1);
    expect(seen).toEqual([null, { sent: ['a'] }]);
    expect(lockLost).toBeInstanceOf(LockLostError);
    const [after] = await db.select({ status: schema.jobs.status, lockedBy: schema.jobs.lockedBy, checkpoint: schema.jobs.checkpoint }).from(schema.jobs).where(eq(schema.jobs.id, row!.id));
    // Der zweite Lauf hatte die Sperre verloren: Status und Zwischenstand bleiben wie vom neuen Besitzer gesetzt.
    expect(after).toMatchObject({ status: 'RUNNING', lockedBy: 'jemand-anderes', checkpoint: { sent: ['a'] } });
    await db.execute(sql`UPDATE jobs SET status = 'DONE' WHERE id = ${row!.id}`);
  });
});
