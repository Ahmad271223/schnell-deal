export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown> & { fields?: Record<string, string> },
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/** Zentraler API-Client. Alle Daten kommen ausschließlich vom Server (keine Mock-Daten). */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined && !isForm ? { 'content-type': 'application/json' } : undefined,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      credentials: 'same-origin',
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Keine Verbindung zum Server. Bitte Internetverbindung prüfen.');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Fehler ${res.status}`, e?.details as ApiError['details']);
  }
  return data as T;
}

export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError ? (err.details?.fields ?? {}) : {};
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unbekannter Fehler';
}

export const photoUrl = (vehicleId: string, photoId: string, variant: 'thumb' | 'web' | 'original' = 'web') =>
  `/api/v1/vehicles/${vehicleId}/photos/${photoId}/file?variant=${variant}`;
export const vehicleDocUrl = (vehicleId: string, docId: string) => `/api/v1/vehicles/${vehicleId}/documents/${docId}/file`;
export const generatedDocUrl = (docId: string) => `/api/v1/documents/${docId}/file`;

export function newId(): string {
  return crypto.randomUUID();
}
