import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db, schema } from '../src/core/db/client';
import { JobWorker } from '../src/core/jobs';
import { createEmailHandler, createPushHandler } from '../src/jobs/handlers';
import { createPlatformUser, uniq } from './helpers';

/** E-Mail- und Push-Jobs dürfen bei Wiederholungen nichts doppelt zustellen, aber auch nichts verlieren. */
describe('Benachrichtigungs-Jobs', () => {
  async function runOnce(type: string, handler: ReturnType<typeof createEmailHandler>) {
    const worker = new JobWorker({ handlers: { [type]: handler } as never });
    return worker.drain(1);
  }
  async function makeDue(id: number) {
    await db.execute(sql`UPDATE jobs SET run_at = now() WHERE id = ${id}`);
  }

  it('wiederholt eine E-Mail nach sauberem SMTP-Fehler, sendet sie aber nicht doppelt', async () => {
    const type = uniq('test.mail');
    const [job] = await db.insert(schema.jobs).values({ type, payload: { to: 'a@test.local', subject: 'Zuschlag', text: 'x' }, priority: 10, maxAttempts: 5 }).returning({ id: schema.jobs.id });
    const delivered: string[] = [];
    let fail = true;
    const handler = createEmailHandler(async (m) => {
      if (fail) throw new Error('ECONNREFUSED');
      delivered.push(m.subject);
    });
    expect(await runOnce(type, handler)).toBe(1);
    const [afterFail] = await db.select({ status: schema.jobs.status, checkpoint: schema.jobs.checkpoint }).from(schema.jobs).where(eq(schema.jobs.id, job!.id));
    expect(afterFail).toMatchObject({ status: 'PENDING', checkpoint: { smtpStarted: false } });

    fail = false;
    await makeDue(job!.id);
    expect(await runOnce(type, handler)).toBe(1);
    expect(delivered).toEqual(['Zuschlag']);
    const [done] = await db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, job!.id));
    expect(done!.status).toBe('DONE');
  });

  it('sendet nach einem Abbruch mitten im Versand nicht erneut und markiert die Zustellung als ungewiss', async () => {
    const user = await createPlatformUser('ADMIN');
    const [n] = await db.insert(schema.notifications).values({ userId: user.userId, type: 'SYSTEM_ALERT', title: 'T', body: 'B', emailStatus: 'PENDING' }).returning({ id: schema.notifications.id });
    const type = uniq('test.mail-crash');
    // Zustand nach einem Absturz: Vermerk „Versand läuft“ gesetzt, Job vom Reaper wieder freigegeben.
    const [job] = await db
      .insert(schema.jobs)
      .values({ type, payload: { to: 'b@test.local', subject: 'Zahlung', text: 'x', notificationId: n!.id }, priority: 10, attempts: 1, checkpoint: { smtpStarted: true } })
      .returning({ id: schema.jobs.id });
    const delivered: string[] = [];
    expect(await runOnce(type, createEmailHandler(async (m) => void delivered.push(m.subject)))).toBe(1);
    expect(delivered).toEqual([]);
    const [row] = await db.select({ emailStatus: schema.notifications.emailStatus }).from(schema.notifications).where(eq(schema.notifications.id, n!.id));
    expect(row!.emailStatus).toBe('UNCERTAIN');
    const [done] = await db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, job!.id));
    expect(done!.status).toBe('DONE');
  });

  it('stellt Push je Abonnement genau einmal zu, auch wenn ein späteres Abonnement den Job scheitern lässt', async () => {
    const user = await createPlatformUser('ADMIN');
    const subs = await db
      .insert(schema.pushSubscriptions)
      .values([1, 2, 3].map((i) => ({ userId: user.userId, endpoint: `https://push.test/${uniq(`ep${i}`)}`, keys: { p256dh: 'k', auth: 'a' } })))
      .returning({ id: schema.pushSubscriptions.id, endpoint: schema.pushSubscriptions.endpoint });
    const type = uniq('test.push');
    const [job] = await db.insert(schema.jobs).values({ type, payload: { userId: user.userId, title: 'Überboten', body: 'x', link: null }, priority: 10, maxAttempts: 3 }).returning({ id: schema.jobs.id });
    const deliveries: string[] = [];
    let failThird = true;
    const handler = createPushHandler(() => async (sub) => {
      if (sub.endpoint === subs[2]!.endpoint && failThird) throw Object.assign(new Error('Push-Dienst 500'), { statusCode: 500 });
      deliveries.push(sub.endpoint);
    });
    expect(await runOnce(type, handler)).toBe(1);
    expect(deliveries).toEqual([subs[0]!.endpoint, subs[1]!.endpoint]);

    failThird = false;
    await makeDue(job!.id);
    expect(await runOnce(type, handler)).toBe(1);
    // Wiederholung bedient nur das bisher gescheiterte Abonnement.
    expect(deliveries).toEqual([subs[0]!.endpoint, subs[1]!.endpoint, subs[2]!.endpoint]);
    const [done] = await db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, job!.id));
    expect(done!.status).toBe('DONE');
  });
});
