import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Request correlation ID + structured request/response logging.
 *
 * - Generates or accepts a `reqId` (from `x-request-id` header)
 * - Attaches `req.log` as a pino child logger with `reqId` bound
 * - Logs request start (method, path) and completion (status, duration, userId)
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Generate or accept correlation ID
  const clientId = req.headers['x-request-id'] as string | undefined;
  const reqId = clientId && UUID_RE.test(clientId) ? clientId : randomUUID();
  req.reqId = reqId;

  // Attach child logger with correlation ID
  req.log = logger.child({ reqId });

  const start = process.hrtime.bigint();

  // Log request start (skip noisy health/metrics probes)
  const path = req.originalUrl || req.url;
  const isProbe = path === '/api/health' || path === '/metrics';
  if (!isProbe) {
    req.log.info({ method: req.method, path }, 'request start');
  }

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    if (!isProbe) {
      req.log.info(
        {
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          ...(req.userId ? { userId: req.userId } : {}),
        },
        'request complete',
      );
    }
  });

  // Set response header so callers can correlate
  res.setHeader('x-request-id', reqId);

  next();
}
