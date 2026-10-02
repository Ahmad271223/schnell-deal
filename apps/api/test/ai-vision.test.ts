import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// drainJobs() arbeitet die gemeinsame Warteschlange ab, in der parallel laufende Testdateien Foto- und PDF-Jobs einreihen.
vi.setConfig({ testTimeout: 120_000 });
import { config } from '../src/config';
import { db, schema } from '../src/core/db/client';
import { checkVehicleFraming, normalizeRecognizedVin, recognizeVinFromImage, setAnthropicTransport, type AnthropicTransport } from '../src/core/ai-vision';
import { drainJobs, startedInspection } from './flows';
import { api, approvedDealership, createPlatformUser, json, sharpJpeg, upload, type Session } from './helpers';

/**
 * KI-Bilderkennung (Claude): FIN vom Foto und „Fahrzeug vollständig im Bild“.
 * Der Anthropic-Dienst wird durch einen Transport ersetzt, der strukturierte Werkzeugantworten liefert;
 * geprüft werden Anfrageaufbau, Normalisierung, Fehlerfälle, Zugriffsschutz und die Wirkung auf die Akte.
 */
const cfg = config as unknown as { ANTHROPIC_API_KEY?: string; AI_PHOTO_CHECK: boolean };
const toolReply = (name: string, input: Record<string, unknown>) => async () => ({ content: [{ type: 'tool_use' as const, name, input }] });

afterEach(() => {
  setAnthropicTransport(null);
  cfg.ANTHROPIC_API_KEY = undefined;
  cfg.AI_PHOTO_CHECK = true;
});

describe('FIN-Erkennung: Normalisierung und Antwortverarbeitung', () => {
  it('bildet unzulässige Zeichen auf ihre Verwechslungen ab und entfernt Trennzeichen', () => {
    expect(normalizeRecognizedVin(' wvw-zzz 1kz 0w0 I2345 ')).toBe('WVWZZZ1KZ0W012345');
    expect(normalizeRecognizedVin('WVWZZZ1KZAW1O2345')).toBe('WVWZZZ1KZAW102345');
    expect(normalizeRecognizedVin('QQ')).toBe('00');
  });

  it('sendet das Bild als JPEG mit erzwungenem Werkzeug und liefert einen validierten Vorschlag', async () => {
    cfg.ANTHROPIC_API_KEY = 'test-key';
    let sent: Record<string, unknown> | null = null;
    const transport: AnthropicTransport = async (body) => {
      sent = body;
      return { content: [{ type: 'tool_use', name: 'report_vin', input: { readable: true, vin: 'WVWZZZ1KZAW1O2345', confidence: 'high', uncertain_positions: [12, 99], notes: 'leichte Spiegelung' } }] };
    };
    setAnthropicTransport(transport);
    const result = await recognizeVinFromImage(await sharpJpeg(1600, 1200, 7));
    expect(result).toMatchObject({ vin: 'WVWZZZ1KZAW102345', confidence: 'high', formatValid: true, uncertainPositions: [12], notes: 'leichte Spiegelung', model: config.ANTHROPIC_MODEL });
    const body = sent as unknown as { model: string; tool_choice: { type: string; name: string }; messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[] };
    expect(body.model).toBe(config.ANTHROPIC_MODEL);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'report_vin' });
    const image = body.messages[0]!.content.find((c) => c.type === 'image')!;
    expect(image.source!.media_type).toBe('image/jpeg');
    expect(Buffer.from(image.source!.data, 'base64').subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });

  it('meldet eine nicht lesbare FIN als klaren Fehler statt eines erfundenen Werts', async () => {
    cfg.ANTHROPIC_API_KEY = 'test-key';
    setAnthropicTransport(toolReply('report_vin', { readable: false, vin: '', confidence: 'low', notes: 'Typenschild verdeckt' }));
    await expect(recognizeVinFromImage(await sharpJpeg(800, 600, 1))).rejects.toMatchObject({ statusCode: 422, code: 'VIN_NOT_READABLE' });
  });

  it('wertet die Bildausschnitt-Prüfung aus', async () => {
    cfg.ANTHROPIC_API_KEY = 'test-key';
    setAnthropicTransport(toolReply('report_vehicle_framing', { vehicle_present: true, fully_visible: false, cut_off_sides: ['left', 'nonsense'], confidence: 'medium' }));
    const r = await checkVehicleFraming(await sharpJpeg(800, 600, 2));
    expect(r).toMatchObject({ vehiclePresent: true, fullyVisible: false, cutOff: ['left', 'nonsense'], confidence: 'medium' });
  });
});

describe('FIN-Erkennung: Route und Akte', () => {
  let admin: Session;
  let inspector: Session;
  let otherInspector: Session;
  let vehicleId: string;

  beforeAll(async () => {
    admin = await createPlatformUser('ADMIN');
    inspector = await createPlatformUser('INSPECTOR');
    otherInspector = await createPlatformUser('INSPECTOR');
    const dealership = await approvedDealership(admin);
    const requestId = await startedInspection(admin, dealership, inspector);
    const created = await api('POST', `/inspector/requests/${requestId}/vehicles`, { session: inspector, body: {} });
    vehicleId = json(created).id;
  });

  it('antwortet ohne API-Schlüssel mit 503 und klarer Meldung', async () => {
    const res = await upload(`/vehicles/${vehicleId}/vin/recognize`, inspector, {}, { name: 'fin.jpg', content: await sharpJpeg(800, 600, 3), type: 'image/jpeg' });
    expect(res.statusCode).toBe(503);
    expect(json(res).error.code).toBe('AI_UNAVAILABLE');
  });

  it('liefert für ein hochgeladenes Foto einen Vorschlag; die FIN wird dadurch nicht gespeichert', async () => {
    cfg.ANTHROPIC_API_KEY = 'test-key';
    setAnthropicTransport(toolReply('report_vin', { readable: true, vin: 'WVWZZZ1KZAW102345', confidence: 'medium' }));
    const res = await upload(`/vehicles/${vehicleId}/vin/recognize`, inspector, {}, { name: 'fin.jpg', content: await sharpJpeg(800, 600, 4), type: 'image/jpeg' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ vin: 'WVWZZZ1KZAW102345', confidence: 'medium', formatValid: true, source: 'upload' });
    const [v] = await db.select({ vin: schema.vehicles.vin }).from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId));
    expect(v!.vin).toBeNull();
  });

  it('nutzt ohne Datei das gespeicherte FIN-Foto und meldet fehlende Fotos', async () => {
    cfg.ANTHROPIC_API_KEY = 'test-key';
    setAnthropicTransport(toolReply('report_vin', { readable: true, vin: 'WVWZZZ1KZAW102345', confidence: 'high' }));
    const none = await api('POST', `/vehicles/${vehicleId}/vin/recognize`, { session: inspector, body: {} });
    expect(none.statusCode).toBe(404);
    expect(json(none).error.code).toBe('NO_VIN_PHOTO');

    const photo = await upload(`/vehicles/${vehicleId}/photos`, inspector, { slot: 'VIN_PLATE', clientUploadId: crypto.randomUUID() }, { name: 'vin.jpg', content: await sharpJpeg(1200, 900, 5), type: 'image/jpeg' });
    expect(photo.statusCode).toBe(201);
    const stored = await api('POST', `/vehicles/${vehicleId}/vin/recognize`, { session: inspector, body: {} });
    expect(stored.statusCode).toBe(200);
    expect(json(stored)).toMatchObject({ vin: 'WVWZZZ1KZAW102345', source: 'stored' });
  });

  it('verweigert fremden Außendienstmitarbeitern den Zugriff (IDOR)', async () => {
    cfg.ANTHROPIC_API_KEY = 'test-key';
    setAnthropicTransport(toolReply('report_vin', { readable: true, vin: 'WVWZZZ1KZAW102345', confidence: 'high' }));
    const res = await api('POST', `/vehicles/${vehicleId}/vin/recognize`, { session: otherInspector, body: {} });
    expect(res.statusCode).toBe(404);
  });

  it('markiert eine abgeschnittene Außenaufnahme als nicht vollständig und zählt sie als fehlendes Pflichtfoto', async () => {
    cfg.ANTHROPIC_API_KEY = 'test-key';
    setAnthropicTransport(toolReply('report_vehicle_framing', { vehicle_present: true, fully_visible: false, cut_off_sides: ['right'], confidence: 'high' }));
    const res = await upload(`/vehicles/${vehicleId}/photos`, inspector, { slot: 'FRONT', clientUploadId: crypto.randomUUID() }, { name: 'front.jpg', content: await sharpJpeg(1200, 900, 6), type: 'image/jpeg' });
    expect(res.statusCode).toBe(201);
    const photoId = json(res).id as string;
    await drainJobs();
    const [p] = await db.select().from(schema.vehiclePhotos).where(eq(schema.vehiclePhotos.id, photoId));
    expect(p!.quality).toBe('CROPPED');
    expect((p!.qualityMetrics as { ai: { cutOff: string[] } }).ai.cutOff).toEqual(['right']);
    const file = json(await api('GET', `/vehicles/${vehicleId}`, { session: inspector }));
    expect(file.completeness.missingPhotoSlots).toContain('FRONT');
    expect(file.photos.find((x: { id: string }) => x.id === photoId).quality).toBe('CROPPED');
  });

  it('lässt ein vollständig sichtbares Fahrzeug unverändert und vermerkt einen Dienstausfall am Foto', async () => {
    cfg.ANTHROPIC_API_KEY = 'test-key';
    setAnthropicTransport(toolReply('report_vehicle_framing', { vehicle_present: true, fully_visible: true, confidence: 'high' }));
    const ok = await upload(`/vehicles/${vehicleId}/photos`, inspector, { slot: 'REAR', clientUploadId: crypto.randomUUID() }, { name: 'rear.jpg', content: await sharpJpeg(1200, 900, 8), type: 'image/jpeg' });
    expect(ok.statusCode).toBe(201);
    await drainJobs();
    const [rear] = await db.select().from(schema.vehiclePhotos).where(eq(schema.vehiclePhotos.id, json(ok).id));
    expect(rear!.quality).toBe('OK');

    setAnthropicTransport(async () => {
      throw new Error('Dienst nicht erreichbar');
    });
    const left = await upload(`/vehicles/${vehicleId}/photos`, inspector, { slot: 'LEFT_SIDE', clientUploadId: crypto.randomUUID() }, { name: 'left.jpg', content: await sharpJpeg(1200, 900, 9), type: 'image/jpeg' });
    await drainJobs();
    const [l] = await db.select().from(schema.vehiclePhotos).where(eq(schema.vehiclePhotos.id, json(left).id));
    expect(l!.quality).toBe('OK');
    expect(l!.uploadStatus).toBe('PROCESSED');
    expect((l!.qualityMetrics as { aiError: { message: string } }).aiError.message).toContain('Dienst nicht erreichbar');
  });

  it('überspringt die Bildprüfung bei Innenaufnahmen und wenn sie abgeschaltet ist', async () => {
    cfg.ANTHROPIC_API_KEY = 'test-key';
    let calls = 0;
    setAnthropicTransport(async () => {
      calls++;
      return { content: [{ type: 'tool_use', name: 'report_vehicle_framing', input: { vehicle_present: true, fully_visible: false, confidence: 'high' } }] };
    });
    const interior = await upload(`/vehicles/${vehicleId}/photos`, inspector, { slot: 'DASHBOARD', clientUploadId: crypto.randomUUID() }, { name: 'dash.jpg', content: await sharpJpeg(1200, 900, 10), type: 'image/jpeg' });
    expect(interior.statusCode).toBe(201);
    await drainJobs();
    cfg.AI_PHOTO_CHECK = false;
    const off = await upload(`/vehicles/${vehicleId}/photos`, inspector, { slot: 'ROOF', clientUploadId: crypto.randomUUID() }, { name: 'roof.jpg', content: await sharpJpeg(1200, 900, 11), type: 'image/jpeg' });
    expect(off.statusCode).toBe(201);
    await drainJobs();
    expect(calls).toBe(0);
  });
});
