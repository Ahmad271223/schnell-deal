import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { JOB_PRIORITY, JobWorker, enqueue } from '../src/core/jobs';
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
