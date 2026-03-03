import { type Response } from 'express';
import { type ZodError } from 'zod/v4';

export function sendValidationError(res: Response, error: ZodError) {
  const details = process.env.NODE_ENV !== 'production' ? error.issues : undefined;
  return res.status(400).json({ error: 'Validation failed', ...(details ? { details } : {}) });
}

export function sendNotFound(res: Response, entity: string) {
  return res.status(404).json({ error: `${entity} not found` });
}

export function sendError(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUUID(id: string, res: Response): boolean {
  if (!UUID_REGEX.test(id)) {
    sendError(res, 400, 'Invalid ID format');
    return false;
  }
  return true;
}
