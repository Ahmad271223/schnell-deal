import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://schnelldeal:schnelldeal@localhost:55432/schnelldeal'),
  DATABASE_POOL_MAX: z.coerce.number().default(20),
  /** Warten auf eine freie Datenbankverbindung (ms). */
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().default(10_000),
  /** Zeitlimit je Abfrage und für untätige Transaktionen (ms); Migrationen sind ausgenommen. */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().default(60_000),
  /** Erlaubte Origins für mutierende Requests und WebSocket (CSRF-Schutz). Kommagetrennt. */
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: bool.default('false'),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  /** Endpoint, der in Signed URLs für den Browser verwendet wird. */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_BUCKET: z.string().default('schnelldeal-private'),
  S3_ACCESS_KEY: z.string().default('schnelldeal'),
  S3_SECRET_KEY: z.string().default('schnelldeal-secret'),
  S3_FORCE_PATH_STYLE: bool.default('true'),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().default(300),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool.default('false'),
  MAIL_FROM: z.string().default('Schnell-Deal <no-reply@schnell-deal.local>'),
  /** inline: Worker läuft im API-Prozess; separate: eigener Prozess (src/worker.ts); off: nur für Tests. */
  WORKER_MODE: z.enum(['inline', 'separate', 'off']).default('inline'),
  /** Auktions-Scheduler (Start/Ende). Läuft standardmäßig in jedem API-Prozess (SKIP LOCKED macht ihn mehrinstanzfähig). */
  SCHEDULER_ENABLED: bool.default('true'),
  SCHEDULER_INTERVAL_MS: z.coerce.number().default(1000),
  CLAMAV_HOST: z.string().optional(),
  /** Anthropic-API für KI-Bilderkennung (FIN vom Foto, Bildausschnitt). Ohne Schlüssel sind diese Funktionen aus. */
  ANTHROPIC_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  ANTHROPIC_MODEL: z.string().default('claude-fable-5-1'),
  /** Günstigeres Modell für die einfache Bildausschnitt-Prüfung; leer = ANTHROPIC_MODEL. Kostenrechnung in docs/12. */
  ANTHROPIC_MODEL_PHOTO_CHECK: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  /** Außenaufnahmen per KI auf „Fahrzeug vollständig im Bild“ prüfen (nur mit API-Schlüssel). */
  AI_PHOTO_CHECK: bool.default('true'),
  CLAMAV_PORT: z.coerce.number().default(3310),
  MAX_UPLOAD_MB: z.coerce.number().default(25),
  /** Motorvideo. Obergrenze 100 MB: clamd scannt Datenströme standardmäßig nur bis StreamMaxLength (100 MB). */
  MAX_VIDEO_UPLOAD_MB: z.coerce.number().min(1).max(100).default(100),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@schnell-deal.local'),
  RATE_LIMIT_DISABLED: bool.default('false'),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: bool.default('false'),
});

export type Config = z.infer<typeof envSchema>;

function load(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Ungültige Konfiguration:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const cfg = parsed.data;
  if ((cfg.NODE_ENV === 'production' || cfg.NODE_ENV === 'staging') && !cfg.COOKIE_SECURE) {
    console.error('COOKIE_SECURE muss in staging/production aktiviert sein.');
    process.exit(1);
  }
  // Platzhalter aus den Vorlagen und Entwicklungs-Standardwerte dürfen nicht in den echten Betrieb gelangen.
  const problems = productionConfigProblems(cfg);
  if (problems.length) {
    if (cfg.NODE_ENV === 'production') {
      console.error('Produktionskonfiguration unvollständig:\n- ' + problems.join('\n- '));
      process.exit(1);
    }
    if (cfg.NODE_ENV === 'staging') console.warn('Hinweis (staging): ' + problems.join(' | '));
  }
  return cfg;
}

const PLACEHOLDERS = new Set(['ersetzen', 'schnelldeal', 'schnelldeal-secret', 'minioadmin', 'changeme', '']);

/** Prüfungen, die in Produktion den Start verhindern (Entwicklungs- und Platzhalterwerte). */
export function productionConfigProblems(cfg: Config): string[] {
  const out: string[] = [];
  if (!cfg.CLAMAV_HOST) out.push('CLAMAV_HOST fehlt (Virenscanner ist Pflicht, §44).');
  if (PLACEHOLDERS.has(cfg.S3_ACCESS_KEY.trim().toLowerCase()) || PLACEHOLDERS.has(cfg.S3_SECRET_KEY.trim().toLowerCase())) out.push('S3_ACCESS_KEY/S3_SECRET_KEY sind Platzhalter oder Entwicklungswerte.');
  if (/:schnelldeal@/.test(cfg.DATABASE_URL)) out.push('DATABASE_URL verwendet das Entwicklungs-Passwort.');
  if (cfg.SMTP_HOST === 'localhost' || PLACEHOLDERS.has((cfg.SMTP_USER ?? '').trim().toLowerCase()) || PLACEHOLDERS.has((cfg.SMTP_PASS ?? '').trim().toLowerCase())) out.push('SMTP_HOST/SMTP_USER/SMTP_PASS sind nicht gesetzt oder Platzhalter.');
  if (/example\.de|localhost/.test(cfg.ALLOWED_ORIGINS) || /example\.de|localhost/.test(cfg.PUBLIC_WEB_URL)) out.push('ALLOWED_ORIGINS/PUBLIC_WEB_URL zeigen auf example.de oder localhost.');
  if (cfg.S3_PUBLIC_ENDPOINT && /example\.de/.test(cfg.S3_PUBLIC_ENDPOINT)) out.push('S3_PUBLIC_ENDPOINT zeigt auf example.de.');
  return out;
}

export const config = load();
export const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
/** Obergrenze einer Ratenbegrenzung; mit RATE_LIMIT_DISABLED (nur Tests und Lasttest) praktisch unbegrenzt. */
export const rateMax = (max: number): number => (config.RATE_LIMIT_DISABLED ? 1_000_000 : max);
