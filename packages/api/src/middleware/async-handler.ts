import type { Request, Response, NextFunction } from 'express';

/**
 * Wrap an async Express handler so rejected promises are forwarded to next().
 * Uses a generic signature to preserve route-param type inference.
 */
export const asyncHandler =
  <P = Record<string, string>>(
    fn: (req: Request<P>, res: Response, next: NextFunction) => Promise<void> | void,
  ) =>
  (req: Request<P>, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
