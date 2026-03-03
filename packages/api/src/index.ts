import dotenv from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });

const APP_VERSION = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf-8'),
).version;
import { sql } from 'drizzle-orm';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { MIN_JWT_SECRET_LENGTH, RATE_LIMIT } from '@fluxure/shared';
import { createStore } from './rate-limiters.js';
import {
  PORT as CONFIG_PORT,
  JSON_BODY_LIMIT,
  SHUTDOWN_TIMEOUT_MS,
  allowedOrigins,
} from './config.js';
import { logger, createLogger } from './logger.js';

const log = createLogger('server');

// Validate required environment variables in production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be set in production and be at least ${MIN_JWT_SECRET_LENGTH} characters`,
    );
  }
  // Note: refresh tokens are opaque hex strings (crypto.randomBytes), not signed JWTs.
  // No JWT_REFRESH_SECRET is needed — refresh tokens are looked up by hash in the sessions table.
  if (!process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be set in production');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in production');
  }
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY must be set in production');
  }
  if (!process.env.COOKIE_DOMAIN) {
    log.warn(
      'COOKIE_DOMAIN is not set — cross-subdomain cookies will not work. This is fine for single-origin deployments.',
    );
  }
}
// AES-256-GCM requires exactly 64 hex chars (32 bytes)
if (process.env.ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
  throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (256 bits for AES-256-GCM)');
}
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in production');
  }
  log.warn(
    'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google Calendar integration will not work',
  );
}
if (process.env.NODE_ENV === 'production' && !process.env.SMTP_HOST) {
  log.warn(
    'SMTP_HOST is not set in production — email verification and password reset will log to console instead of sending emails',
  );
}

import { db, closeDb } from './db/pg-index.js';
import { runMigrations } from './db/migrate.js';
import { schedulerRegistry } from './scheduler-registry.js';
import { initRedis, closeRedis, getRedisClient } from './cache/redis.js';
import { initWorkerPool, closeWorkerPool } from './workers/pool.js';
import { startRetentionCleanupFallback, stopRetentionCleanup } from './data-retention.js';
import { startQueues, startWorkers, stopQueues } from './jobs/queues.js';

import habitsRouter from './routes/habits.js';
import tasksRouter from './routes/tasks.js';
import meetingsRouter from './routes/meetings.js';
import focusRouter from './routes/focus.js';
import buffersRouter from './routes/buffers.js';
import scheduleRouter from './routes/schedule.js';
import linksRouter from './routes/links.js';
import analyticsRouter from './routes/analytics.js';
import authRouter, { startOAuthCleanupFallback, stopOAuthCleanup } from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import calendarsRouter from './routes/calendars.js';
import searchRouter from './routes/search.js';
import activityRouter from './routes/activity.js';
import bookingRouter from './routes/booking.js';
import quickAddRouter from './routes/quick-add.js';
import webhooksRouter from './routes/webhooks.js';
import schedulingTemplatesRouter from './routes/scheduling-templates.js';
import billingRouter from './routes/billing.js';
import billingWebhookRouter from './routes/billing-webhook.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { requestLogger } from './middleware/request-logger.js';

const app = express();
const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv !== undefined && trustProxyEnv !== '' && isNaN(parseInt(trustProxyEnv, 10))) {
  throw new Error('TRUST_PROXY must be a number (count of trusted proxy hops)');
}
app.set('trust proxy', trustProxyEnv ? parseInt(trustProxyEnv, 10) : 0);
if (process.env.NODE_ENV === 'production' && !trustProxyEnv) {
  log.warn('TRUST_PROXY is not set — rate limiting may be ineffective behind a reverse proxy');
}
const PORT = CONFIG_PORT;

const wsOrigins = allowedOrigins.map((o) => o.replace(/^http/, 'ws'));

// 'unsafe-inline' required because SvelteKit static builds emit inline script/style tags.
// Proper fix is nonce-based CSP in the SvelteKit build pipeline.
app.use(
  helmet({
    strictTransportSecurity: {
      maxAge: 63072000, // 2 years
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
        connectSrc: [
          "'self'",
          ...allowedOrigins,
          ...wsOrigins,
          ...wsOrigins.map((o) => o.replace('ws:', 'wss:')),
        ],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }),
);

// Registered before body parsing so Stripe raw-body requirement is not affected
app.use(requestLogger);

app.use(metricsMiddleware);

// Must be registered before express.json() to preserve raw body for Stripe signature verification
app.use('/api/webhooks/stripe', billingWebhookRouter);

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(cookieParser());

const globalLimiter = rateLimit({
  ...RATE_LIMIT.global,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  store: createStore('global'),
});
app.use('/api', globalLimiter);

const webhookLimiter = rateLimit({
  ...RATE_LIMIT.webhook,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many webhook requests.' },
  store: createStore('webhook'),
});
app.use('/api/webhooks', webhookLimiter);

const rescheduleLimiter = rateLimit({
  ...RATE_LIMIT.reschedule,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reschedule requests, please try again later.' },
  store: createStore('reschedule'),
});
app.use('/api/schedule/reschedule', rescheduleLimiter);

const billingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many billing requests, please try again later.' },
  store: createStore('billing'),
});
app.use('/api/billing', billingLimiter);

const authLimiter = rateLimit({
  ...RATE_LIMIT.oauth,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many auth requests, please try again later.' },
  store: createStore('oauth'),
});
app.use('/api/auth/google', authLimiter);

import { requireAuth } from './middleware/auth.js';

const PUBLIC_ROUTE_PATTERNS: RegExp[] = [
  /^\/api\/health$/,
  /^\/api\/auth\//,
  /^\/api\/book\//,
  /^\/api\/webhooks\//,
];

app.use('/api', (req, res, next) => {
  const fullPath = `/api${req.path}`;
  const isPublic = PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(fullPath));

  if (isPublic) {
    next();
    return;
  }

  requireAuth(req, res, next);
});

let isShuttingDown = false;
let inFlightRequests = 0;
let drainResolve: (() => void) | null = null;

app.use((_req, res, next) => {
  if (isShuttingDown) {
    res.status(503).json({ error: 'Server is shutting down' });
    return;
  }
  inFlightRequests++;
  res.on('close', () => {
    inFlightRequests--;
    if (isShuttingDown && inFlightRequests <= 0 && drainResolve) {
      drainResolve();
    }
  });
  next();
});

app.get('/api/health', async (_req, res) => {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // db unreachable
  }

  const status = dbOk ? 'ok' : 'unhealthy';
  res.status(dbOk ? 200 : 503).json({ status });
});

app.use('/api/habits', habitsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/focus-time', focusRouter);
app.use('/api/buffers', buffersRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/links', linksRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/calendars', calendarsRouter);
app.use('/api/search', searchRouter);
app.use('/api/activity', activityRouter);
app.use('/api/book', bookingRouter);
app.use('/api/quick-add', quickAddRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/scheduling-templates', schedulingTemplatesRouter);
app.use('/api/billing', billingRouter);

app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// WebSocket + Scheduler Registry
// ============================================================

import { initWebSocket, closeWebSocket } from './ws.js';

// ============================================================
// Server Startup
// ============================================================

async function startServer() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set');
  }

  // Fail fast with actionable error if database is unreachable
  try {
    const { Pool } = await import('pg');
    const testPool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await testPool.query('SELECT 1');
    await testPool.end();
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ECONNREFUSED') {
      const parsed = new URL(databaseUrl);
      log.fatal(
        { host: parsed.hostname, port: parsed.port || '5432' },
        'Cannot connect to PostgreSQL at %s:%s. Is the database running? Try: docker compose -f docker-compose.dev.yml up -d',
        parsed.hostname,
        parsed.port || '5432',
      );
      process.exit(1);
    }
    throw err;
  }

  await runMigrations(databaseUrl);

  await initRedis();

  // Redis is required in production for distributed locking, caching, and pub/sub
  if (process.env.NODE_ENV === 'production' && !getRedisClient()) {
    log.fatal('Redis is required in production for distributed locking, caching, and pub/sub');
    process.exit(1);
  }

  await initWorkerPool();

  // BullMQ queues handle cleanup jobs; fall back to timers if Redis unavailable
  const queuesStarted = await startQueues();
  if (queuesStarted) {
    startWorkers();
    log.info('BullMQ queues and workers started — timer-based cleanup disabled');
  } else {
    startRetentionCleanupFallback();
    startOAuthCleanupFallback();
    log.info('BullMQ unavailable — using timer-based cleanup fallback');
  }

  // Non-blocking: log a warning if SMTP is unreachable but don't block startup
  const { verifySmtpConnection } = await import('./auth/email.js');
  void verifySmtpConnection();

  schedulerRegistry
    .startAll()
    .then(() => {
      log.info('All user schedulers initialized');
    })
    .catch((err) => {
      log.error({ err }, 'Failed to start schedulers');
    });

  const server = app.listen(PORT, () => {
    log.info({ port: PORT, version: APP_VERSION }, 'Fluxure API v%s running', APP_VERSION);
  });
  initWebSocket(server);

  let shutdownInProgress = false;

  async function gracefulShutdown(signal: string) {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    isShuttingDown = true;
    log.info({ signal }, 'Shutting down gracefully');

    // Safety net: force exit if graceful shutdown exceeds timeout
    const forceTimer = setTimeout(() => {
      log.fatal({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Forced shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    // Stop accepting new connections
    server.close(() => {
      log.info('HTTP server closed');
    });

    // Wait for in-flight requests to drain (or timeout after half the budget)
    if (inFlightRequests > 0) {
      log.info({ inFlightRequests }, 'Waiting for in-flight requests to drain');
      const drainTimeout = Math.floor(SHUTDOWN_TIMEOUT_MS / 2);
      await Promise.race([
        new Promise<void>((resolve) => {
          drainResolve = resolve;
        }),
        new Promise<void>((resolve) => setTimeout(resolve, drainTimeout)),
      ]);
      if (inFlightRequests > 0) {
        log.warn({ inFlightRequests }, 'Drain timeout reached, forcing remaining connections');
      }
    }

    // Force-close idle keep-alive connections
    server.closeAllConnections();

    // Clear periodic cleanup timers
    stopOAuthCleanup();
    stopRetentionCleanup();

    // Stop background subsystems in parallel
    await Promise.allSettled([
      schedulerRegistry.stopAll(),
      stopQueues(),
      closeWorkerPool(),
      closeRedis(),
      closeWebSocket(),
    ]);
    log.info('Background subsystems stopped');

    // Close DB pool last since subsystems may issue final queries
    await closeDb();
    log.info('Database pool closed — shutdown complete');

    // Flush logs before exiting
    logger.flush();
    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Catch unhandled errors to prevent silent crashes
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'Uncaught exception — exiting');
    logger.flush();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log.fatal({ reason }, 'Unhandled rejection — exiting');
    logger.flush();
    process.exit(1);
  });
}

startServer().catch((err) => {
  log.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

export default app;
