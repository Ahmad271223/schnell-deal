import { DEFAULT_SETTINGS, settingsSchema, type PlatformSettings } from '@sd/shared';
import { db, schema, type DbOrTx } from './db/client';

const KEY = 'platform';

/** Liest die Plattform-Einstellungen; fehlende Schlüssel werden mit Defaults ergänzt. */
export async function getSettings(tx: DbOrTx = db): Promise<PlatformSettings> {
  const rows = await tx.select().from(schema.platformSettings).limit(10);
  const row = rows.find((r) => r.key === KEY);
  const merged = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<PlatformSettings>) ?? {}) };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(tx: DbOrTx, value: PlatformSettings, userId: string | null): Promise<void> {
  await tx
    .insert(schema.platformSettings)
    .values({ key: KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.platformSettings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}
