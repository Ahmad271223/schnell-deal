import { config } from '../../config';
import { getSettings } from '../../core/settings';
import { endDueAuctions, notifyEndingSoon, releaseExpiredTempBlocks, startDueAuctions } from './service';

/** Betriebszustand des Auktionstakts; wird im Health-Endpunkt und im Admin-Systemstatus angezeigt. */
export const schedulerStatus = {
  lastTickAt: null as string | null,
  lastError: null as string | null,
  tickRunningSince: null as string | null,
};

/** Ab dieser Dauer gilt ein Takt als hängend und wird laut gemeldet (bis die Datenbank-Zeitlimits ihn abbrechen). */
const STUCK_AFTER_MS = 30_000;

/**
 * Serverseitiger Auktionstakt (Standard: jede Sekunde).
 *
 * Der gesamte Zustand liegt in der Datenbank. Nach einem Neustart werden überfällige Auktionen
 * im ersten Takt beendet – maßgeblich sind die gespeicherten Gebote, die nur vor `ends_at`
 * angenommen werden konnten. Mehrere Instanzen sind sicher (FOR UPDATE SKIP LOCKED).
 *
 * Ein hängender Takt (z. B. abgerissene Datenbankverbindung) würde ohne Gegenmaßnahme alle weiteren Takte
 * blockieren und Auktionen nicht mehr starten oder beenden. Deshalb: Datenbank-Zeitlimits brechen hängende
 * Abfragen ab, und ein Wächter meldet einen überlangen Takt jede halbe Minute im Protokoll.
 */
export class AuctionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticking = false;
  private lastSlowTick = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  isTicking(): boolean {
    return this.ticking;
  }

  private loop(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.tick();
      this.loop();
    }, config.SCHEDULER_INTERVAL_MS);
  }

  /** Ein Takt; auch direkt aus Tests aufrufbar. */
  async tick(): Promise<{ started: number; ended: number }> {
    if (this.ticking) return { started: 0, ended: 0 };
    this.ticking = true;
    const startedAt = Date.now();
    schedulerStatus.tickRunningSince = new Date(startedAt).toISOString();
    const watchdog = setInterval(() => {
      console.error(`[scheduler] Auktionstakt läuft seit ${Math.round((Date.now() - startedAt) / 1000)} s – Datenbankverbindung hängt? Auktionen werden derzeit nicht gestartet oder beendet.`);
    }, STUCK_AFTER_MS);
    try {
      const started = await startDueAuctions();
      const ended = await endDueAuctions();
      if (Date.now() - this.lastSlowTick > 15_000) {
        this.lastSlowTick = Date.now();
        const settings = await getSettings();
        await notifyEndingSoon(settings.endingSoonMinutes);
        await releaseExpiredTempBlocks();
      }
      schedulerStatus.lastTickAt = new Date().toISOString();
      schedulerStatus.lastError = null;
      return { started, ended };
    } catch (err) {
      // Kein stiller Fehler: protokollieren; der nächste Takt versucht es erneut.
      schedulerStatus.lastError = `${new Date().toISOString()}: ${(err as Error).message}`;
      console.error('[scheduler] Fehler im Auktionstakt', err);
      return { started: 0, ended: 0 };
    } finally {
      clearInterval(watchdog);
      schedulerStatus.tickRunningSince = null;
      this.ticking = false;
    }
  }
}
