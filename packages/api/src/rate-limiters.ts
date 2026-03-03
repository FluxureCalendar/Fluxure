import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { SendCommandFn } from 'rate-limit-redis';
import { RATE_LIMIT } from '@fluxure/shared';
import { getRedisClient } from './cache/redis.js';

export function createStore(prefix: string): RedisStore | undefined {
  const redis = getRedisClient();
  if (!redis) return undefined;
  const sendCommand: SendCommandFn = (...args: string[]) =>
    redis.call(args[0], ...args.slice(1)) as Promise<
      ReturnType<SendCommandFn> extends Promise<infer R> ? R : never
    >;
  return new RedisStore({
    sendCommand,
    prefix: `rl:${prefix}:`,
  });
}

// Booking rate limiter — applied inline on router handlers in links.ts and booking.ts
export const bookingLimiter = rateLimit({
  ...RATE_LIMIT.bookingSubmit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many booking requests, please try again later.' },
  store: createStore('booking'),
});
