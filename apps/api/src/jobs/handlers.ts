import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { db, schema } from '../core/db/client';
import { sendMail } from '../core/mail';
import { JobWorker, type JobHandler, type JobType } from '../core/jobs';
import { audit, SYSTEM_ACTOR } from '../core/audit';
import { config } from '../config';
import { notifyAdmins } from '../modules/notifications/service';
import { processPhotoJob } from '../modules/vehicles/photo-processing';
import { generateDealDocumentsJob } from '../modules/deals/pdf';

/**
 * E-Mail höchstens einmal: Der Zwischenstand „Versand begonnen“ wird vor dem SMTP-Aufruf gespeichert. Stürzt der
 * Worker danach ab, sendet die Wiederholung nicht erneut (Zustellung ungewiss, Status UNCERTAIN), statt Händlern
 * dieselbe Zuschlags- oder Zahlungsnachricht zweimal zu schicken.
 */
const emailHandler: JobHandler = async (payload: { notificationId?: string; to: string; subject: string; text: string }, job) => {
  if (job.checkpoint?.smtpStarted) {
    console.warn(`[jobs] E-Mail-Job ${job.id}: vorheriger Versuch war bereits beim Versand – kein erneuter Versand, Zustellung ungewiss.`);
    if (payload.notificationId) {
      await db.update(schema.notifications).set({ emailStatus: 'UNCERTAIN' }).where(eq(schema.notifications.id, payload.notificationId));
    }
    return;
  }
  await job.saveCheckpoint({ smtpStarted: true });
  await sendMail({ to: payload.to, subject: payload.subject, text: payload.text });
  if (payload.notificationId) {
    await db.update(schema.notifications).set({ emailStatus: 'SENT' }).where(eq(schema.notifications.id, payload.notificationId));
  }
};

let vapidReady = false;
/** Push je Abonnement genau einmal: erfolgreich bediente Abonnements stehen im Zwischenstand und werden bei Wiederholung übersprungen. */
const pushHandler: JobHandler = async (payload: { userId: string; title: string; body: string; link: string | null }, job) => {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) return;
  if (!vapidReady) {
    webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
    vapidReady = true;
  }
  const sent = new Set<string>(Array.isArray(job.checkpoint?.sent) ? (job.checkpoint!.sent as string[]) : []);
  const subs = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, payload.userId));
  for (const s of subs) {
    if (sent.has(s.id)) continue;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } },
        JSON.stringify({ title: payload.title, body: payload.body, link: payload.link }),
      );
      sent.add(s.id);
      await job.saveCheckpoint({ sent: [...sent] });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // Abgelaufene Subscriptions entfernen.
      if (status === 404 || status === 410) {
        await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id));
      } else {
        throw err;
      }
    }
  }
};

export const jobHandlers: Partial<Record<JobType, JobHandler>> = {
  'email.send': emailHandler,
  'push.send': pushHandler,
  'image.process': processPhotoJob,
  'pdf.deal': generateDealDocumentsJob,
};

/** Endgültig fehlgeschlagene Jobs werden nie still verworfen: Audit + Admin-Benachrichtigung. */
async function onJobFailed(job: { id: number; type: string; error: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    const payload = (row?.payload ?? {}) as Record<string, unknown>;
    if (job.type === 'email.send' && typeof payload.notificationId === 'string') {
      await tx.update(schema.notifications).set({ emailStatus: 'FAILED' }).where(eq(schema.notifications.id, payload.notificationId));
    }
    await audit(tx, SYSTEM_ACTOR, { event: 'JOB_FAILED', entityType: 'job', entityId: String(job.id), newValue: { type: job.type, error: job.error } });
    // E-Mail-Fehler nicht erneut per E-Mail melden (Schleife vermeiden).
    await notifyAdmins(tx, {
      type: 'SYSTEM_ALERT',
      title: `Hintergrundjob fehlgeschlagen: ${job.type}`,
      body: `Job #${job.id} ist nach mehreren Versuchen fehlgeschlagen: ${job.error.slice(0, 300)}`,
      link: '/admin/einstellungen?tab=system',
      email: job.type !== 'email.send',
    });
  });
}

export function createWorker(): JobWorker {
  return new JobWorker({ handlers: jobHandlers, concurrency: 4, onFailed: onJobFailed });
}
