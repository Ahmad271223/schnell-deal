import { ZodError, type ZodTypeAny, type z } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Ressource') => new AppError(404, 'NOT_FOUND', `${what} nicht gefunden`);
export const forbidden = (message = 'Keine Berechtigung für diese Aktion') => new AppError(403, 'FORBIDDEN', message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function validationError(err: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return new AppError(400, 'VALIDATION_ERROR', 'Eingaben sind ungültig', { fields });
}
