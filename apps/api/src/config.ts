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
  /** Außenaufnahmen per KI auf „Fahrzeug vollständig im Bild“ prüfen (nur mit API-Schlüssel). */
  AI_PHOTO_CHECK: bool.default('true'),
  CLAMAV_PORT: z.coerce.number().default(3310),
  MAX_UPLOAD_MB: z.coerce.number().default(25),
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
  return cfg;
}

export const config = load();
export const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
/** Emergent-Preview-Domains: der Ingress schreibt den Origin-Header auf wechselnde interne Hosts um. */
const PREVIEW_HOST_SUFFIXES = ['.preview.emergentagent.com', '.preview.emergentcf.cloud', '.emergent.host'];
/** Erlaubte Herkunft für CSRF/WebSocket: konfigurierte Origins oder eine Emergent-Preview-Domain. */
export const isAllowedOrigin = (origin: string): boolean => {
  if (allowedOrigins.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return PREVIEW_HOST_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
};
/** Obergrenze einer Ratenbegrenzung; mit RATE_LIMIT_DISABLED (nur Tests und Lasttest) praktisch unbegrenzt. */
export const rateMax = (max: number): number => (config.RATE_LIMIT_DISABLED ? 1_000_000 : max);
