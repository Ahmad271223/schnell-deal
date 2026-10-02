import sharp from 'sharp';
import { validateVin } from '@sd/shared';
import { config } from '../config';
import { AppError } from './errors';

/*
 * Bildverstehen mit Claude (Anthropic Messages API):
 *  - FIN von einem Foto der FIN-Plakette ablesen (Typenschild, Türholm, Windschutzscheibe). Der Außendienst wird angewiesen,
 *    nicht den Fahrzeugschein zu fotografieren (Halterdaten); landet trotzdem einer im Bild, wird nur die FIN gelesen.
 *  - Prüfen, ob das Fahrzeug auf einer Außenaufnahme vollständig im Bild ist (Spezifikation §11).
 *
 * Grundsätze: Die KI liefert nur Vorschläge. Die FIN speichert ausschließlich der Mitarbeiter nach Prüfung;
 * die bestehende Validierung und Duplikatprüfung bleiben unverändert. Alle Antworten kommen strukturiert
 * über ein erzwungenes Werkzeug (keine Freitext-Interpretation). Fehler des Dienstes werden klar gemeldet.
 * Das Foto verlässt dafür die Plattform (Datenschutzhinweis in docs/09-security-review.md).
 */

export const aiVisionEnabled = (): boolean => Boolean(config.ANTHROPIC_API_KEY);

interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}
interface MessagesResponse {
  content: Array<ToolUseBlock | { type: string; text?: string }>;
  stop_reason?: string;
  model?: string;
}

export type AnthropicTransport = (body: Record<string, unknown>) => Promise<MessagesResponse>;

const unavailable = (message: string) => new AppError(503, 'AI_UNAVAILABLE', message);

const defaultTransport: AnthropicTransport = async (body) => {
  if (!config.ANTHROPIC_API_KEY) throw unavailable('KI-Bilderkennung ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt).');
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    throw unavailable(`KI-Dienst nicht erreichbar: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw unavailable('KI-Dienst lehnt den API-Schlüssel ab (ANTHROPIC_API_KEY prüfen).');
    if (res.status === 429) throw unavailable('KI-Dienst: Anfragelimit erreicht. Bitte in Kürze erneut versuchen.');
    throw unavailable(`KI-Dienst antwortet mit Status ${res.status}: ${text}`);
  }
  return (await res.json()) as MessagesResponse;
};

let transport: AnthropicTransport = defaultTransport;

/** Nur für Tests: Transport austauschen (null = Standard). */
export function setAnthropicTransport(t: AnthropicTransport | null): void {
  transport = t ?? defaultTransport;
}

/** Bild für die Übertragung verkleinern (max. 1568 px, JPEG, ohne Metadaten). */
async function prepareImage(buf: Buffer): Promise<string> {
  try {
    const jpeg = await sharp(buf).rotate().resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    return jpeg.toString('base64');
  } catch {
    throw new AppError(422, 'IMAGE_UNREADABLE', 'Das Bild konnte nicht gelesen werden. Bitte Foto erneut aufnehmen.');
  }
}

async function askWithTool<T extends Record<string, unknown>>(system: string, instruction: string, image: Buffer, tool: { name: string; description: string; input_schema: Record<string, unknown> }, model = config.ANTHROPIC_MODEL): Promise<T> {
  const data = await prepareImage(image);
  const res = await transport({
    model,
    max_tokens: 400,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: instruction },
        ],
      },
    ],
  });
  const block = res.content.find((c): c is ToolUseBlock => c.type === 'tool_use' && (c as ToolUseBlock).name === tool.name);
  if (!block) throw unavailable('KI-Dienst hat keine auswertbare Antwort geliefert.');
  return block.input as T;
}

// ---------------------------------------------------------------- FIN

export interface VinRecognition {
  vin: string;
  confidence: 'high' | 'medium' | 'low';
  formatValid: boolean;
  checkDigitValid: boolean;
  errors: string[];
  /** 1-basierte Positionen, die laut KI unsicher gelesen wurden. */
  uncertainPositions: number[];
  notes: string | null;
  model: string;
}

/** Zeichen, die in einer FIN nicht vorkommen, werden auf ihre üblichen Verwechslungen abgebildet. */
export function normalizeRecognizedVin(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/Q/g, '0')
    .replace(/I/g, '1');
}

const VIN_TOOL = {
  name: 'report_vin',
  description: 'Meldet die auf dem Foto gelesene Fahrzeug-Identifizierungsnummer (FIN/VIN).',
  input_schema: {
    type: 'object',
    properties: {
      readable: { type: 'boolean', description: 'false, wenn auf dem Foto keine FIN erkennbar ist' },
      vin: { type: 'string', description: 'Die gelesene FIN, 17 Zeichen, ohne Leerzeichen; leer wenn nicht lesbar' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      uncertain_positions: { type: 'array', items: { type: 'integer' }, description: '1-basierte Positionen unsicher gelesener Zeichen' },
      notes: { type: 'string', description: 'Kurzer Hinweis, z. B. Spiegelung oder abgeschnittene Zeichen' },
    },
    required: ['readable', 'vin', 'confidence'],
  },
};

export async function recognizeVinFromImage(image: Buffer): Promise<VinRecognition> {
  const r = await askWithTool<{ readable: boolean; vin: string; confidence: 'high' | 'medium' | 'low'; uncertain_positions?: number[]; notes?: string }>(
    'Du liest Fahrzeug-Identifizierungsnummern (FIN/VIN) von Fotos der FIN-Plakette am Fahrzeug ab: Typenschild, Aufkleber im Türrahmen oder Windschutzscheibe. Lies ausschließlich die FIN; alle anderen Angaben im Bild (Namen, Anschriften, Kennzeichen) ignorierst du und gibst sie nicht wieder. Eine FIN hat genau 17 Zeichen aus Buchstaben und Ziffern; die Buchstaben I, O und Q kommen nie vor (lies sie als 1, 0, 0). Erfinde keine Zeichen. Wenn ein Zeichen unsicher ist, nenne seine Position in uncertain_positions und senke confidence. Antworte ausschließlich über das Werkzeug report_vin.',
    'Lies die FIN auf diesem Foto ab.',
    image,
    VIN_TOOL,
  );
  const vin = normalizeRecognizedVin(String(r.vin ?? ''));
  if (!r.readable || vin.length < 11) {
    throw new AppError(422, 'VIN_NOT_READABLE', 'Die FIN konnte auf dem Foto nicht gelesen werden. Bitte näher, gerade und ohne Spiegelung fotografieren oder die FIN manuell eingeben.', {
      notes: r.notes ?? null,
    });
  }
  const check = validateVin(vin);
  const confidence = (['high', 'medium', 'low'] as const).includes(r.confidence) ? r.confidence : 'low';
  return {
    vin,
    confidence,
    formatValid: check.formatValid,
    checkDigitValid: check.checkDigitValid,
    errors: check.errors,
    uncertainPositions: Array.isArray(r.uncertain_positions) ? r.uncertain_positions.filter((n) => Number.isInteger(n) && n >= 1 && n <= 17) : [],
    notes: r.notes ? String(r.notes).slice(0, 300) : null,
    model: config.ANTHROPIC_MODEL,
  };
}

// ---------------------------------------------------------------- Bildausschnitt (Außenaufnahmen)

export interface FramingCheck {
  vehiclePresent: boolean;
  fullyVisible: boolean;
  cutOff: string[];
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
  model: string;
}

const FRAMING_TOOL = {
  name: 'report_vehicle_framing',
  description: 'Meldet, ob auf dem Foto ein Fahrzeug vollständig im Bild ist.',
  input_schema: {
    type: 'object',
    properties: {
      vehicle_present: { type: 'boolean', description: 'Ist ein Fahrzeug das Hauptmotiv?' },
      fully_visible: { type: 'boolean', description: 'true nur, wenn kein Teil des Fahrzeugs vom Bildrand abgeschnitten ist' },
      cut_off_sides: { type: 'array', items: { type: 'string', enum: ['left', 'right', 'top', 'bottom'] }, description: 'Bildränder, an denen das Fahrzeug abgeschnitten ist' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      notes: { type: 'string' },
    },
    required: ['vehicle_present', 'fully_visible', 'confidence'],
  },
};

/** Modell für die Bildausschnitt-Prüfung (günstiger wählbar). */
const framingModel = () => config.ANTHROPIC_MODEL_PHOTO_CHECK ?? config.ANTHROPIC_MODEL;

export async function checkVehicleFraming(image: Buffer): Promise<FramingCheck> {
  const r = await askWithTool<{ vehicle_present: boolean; fully_visible: boolean; cut_off_sides?: string[]; confidence: 'high' | 'medium' | 'low'; notes?: string }>(
    'Du prüfst Außenaufnahmen für eine Fahrzeugakte. Melde, ob ein Fahrzeug das Hauptmotiv ist und ob es vollständig im Bild liegt. Vollständig bedeutet: keine Karosserieteile, Räder oder Spiegel sind vom Bildrand abgeschnitten. Bewerte keine Schäden und keinen Zustand. Antworte ausschließlich über das Werkzeug report_vehicle_framing.',
    'Ist das Fahrzeug auf diesem Foto vollständig im Bild?',
    image,
    FRAMING_TOOL,
    framingModel(),
  );
  const confidence = (['high', 'medium', 'low'] as const).includes(r.confidence) ? r.confidence : 'low';
  return {
    vehiclePresent: Boolean(r.vehicle_present),
    fullyVisible: Boolean(r.fully_visible),
    cutOff: Array.isArray(r.cut_off_sides) ? r.cut_off_sides.filter((s): s is string => typeof s === 'string').slice(0, 4) : [],
    confidence,
    notes: r.notes ? String(r.notes).slice(0, 300) : null,
    model: framingModel(),
  };
}
