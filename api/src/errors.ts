import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, ZodSchema, z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in to continue') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = "You don't have permission to do that") =>
  new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export function parse<S extends ZodSchema>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function validationError(err: ZodError) {
  const first = err.issues[0];
  const field = first?.path.join('.');
  return new HttpError(
    400,
    'validation_failed',
    field ? `${field}: ${first.message}` : first?.message || 'Invalid request',
    err.flatten().fieldErrors,
  );
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Route'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'Request body is not valid JSON' } });
    return;
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'file_too_large', message: 'That file is too large to upload' } });
    return;
  }
  if (err?.code === '22P02') {
    // Malformed id (e.g. not a UUID) in a path parameter: treat as missing.
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
    return;
  }
  if (err?.code === '23505') {
    res.status(409).json({ error: { code: 'conflict', message: 'That already exists' } });
    return;
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
};
