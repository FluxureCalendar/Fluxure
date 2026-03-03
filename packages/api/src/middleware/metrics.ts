import type { Request, Response, NextFunction } from 'express';

// ============================================================
// Simple Prometheus-compatible metrics (no external library)
// ============================================================

interface HistogramBucket {
  le: number;
  count: number;
}

interface RouteKey {
  method: string;
  route: string;
  status: number;
}

// --- Cardinality cap to prevent unbounded Map growth from arbitrary paths ---
const MAX_METRIC_KEYS = 1000;

// --- Counters ---
const httpRequestsTotal = new Map<string, number>();
const httpErrorsTotal = new Map<string, number>();
let activeConnections = 0;

// --- Histogram (request duration in seconds) ---
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const durationBuckets = new Map<string, HistogramBucket[]>();
const durationSum = new Map<string, number>();
const durationCount = new Map<string, number>();

function routeKey(method: string, route: string, status: number): string {
  return `${method}|${route}|${status}`;
}

function normalizeRoute(req: Request): string {
  // Use Express matched route if available (e.g., /api/habits/:id),
  // otherwise fall back to the raw path but collapse UUIDs and numeric IDs
  if (req.route?.path && req.baseUrl) {
    return `${req.baseUrl}${req.route.path}`;
  }
  return req.path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function recordRequest(method: string, route: string, status: number, durationSec: number): void {
  const key = routeKey(method, route, status);

  // Skip recording if this is a new key and we've hit the cardinality cap
  if (!httpRequestsTotal.has(key) && httpRequestsTotal.size >= MAX_METRIC_KEYS) return;

  // Increment request counter
  httpRequestsTotal.set(key, (httpRequestsTotal.get(key) ?? 0) + 1);

  // Increment error counter for 4xx/5xx
  if (status >= 400) {
    const errKey = `${method}|${route}|${status >= 500 ? '5xx' : '4xx'}`;
    httpErrorsTotal.set(errKey, (httpErrorsTotal.get(errKey) ?? 0) + 1);
  }

  // Record duration in histogram buckets
  if (!durationBuckets.has(key)) {
    durationBuckets.set(
      key,
      DURATION_BUCKETS.map((le) => ({ le, count: 0 })),
    );
    durationSum.set(key, 0);
    durationCount.set(key, 0);
  }
  const buckets = durationBuckets.get(key)!;
  for (const bucket of buckets) {
    if (durationSec <= bucket.le) {
      bucket.count++;
    }
  }
  durationSum.set(key, (durationSum.get(key) ?? 0) + durationSec);
  durationCount.set(key, (durationCount.get(key) ?? 0) + 1);
}

// --- Middleware ---

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  activeConnections++;
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    activeConnections--;
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;
    const route = normalizeRoute(req);
    recordRequest(req.method, route, res.statusCode, durationSec);
  });

  next();
}

// --- Prometheus text format ---

function parseKey(key: string): RouteKey {
  const [method, route, status] = key.split('|');
  return { method, route, status: parseInt(status, 10) };
}

export function formatMetrics(): string {
  const lines: string[] = [];

  // http_requests_total
  lines.push('# HELP http_requests_total Total number of HTTP requests');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, count] of httpRequestsTotal) {
    const { method, route, status } = parseKey(key);
    lines.push(
      `http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`,
    );
  }

  // http_errors_total
  lines.push('# HELP http_errors_total Total number of HTTP error responses');
  lines.push('# TYPE http_errors_total counter');
  for (const [key, count] of httpErrorsTotal) {
    const [method, route, category] = key.split('|');
    lines.push(
      `http_errors_total{method="${method}",route="${route}",category="${category}"} ${count}`,
    );
  }

  // http_active_connections
  lines.push('# HELP http_active_connections Number of currently active HTTP connections');
  lines.push('# TYPE http_active_connections gauge');
  lines.push(`http_active_connections ${activeConnections}`);

  // http_request_duration_seconds (histogram)
  lines.push('# HELP http_request_duration_seconds HTTP request duration in seconds');
  lines.push('# TYPE http_request_duration_seconds histogram');
  for (const [key, buckets] of durationBuckets) {
    const { method, route, status } = parseKey(key);
    const labels = `method="${method}",route="${route}",status="${status}"`;
    for (const bucket of buckets) {
      lines.push(
        `http_request_duration_seconds_bucket{${labels},le="${bucket.le}"} ${bucket.count}`,
      );
    }
    lines.push(
      `http_request_duration_seconds_bucket{${labels},le="+Inf"} ${durationCount.get(key) ?? 0}`,
    );
    lines.push(`http_request_duration_seconds_sum{${labels}} ${durationSum.get(key) ?? 0}`);
    lines.push(`http_request_duration_seconds_count{${labels}} ${durationCount.get(key) ?? 0}`);
  }

  // process_uptime_seconds
  lines.push('# HELP process_uptime_seconds Process uptime in seconds');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${Math.floor(process.uptime())}`);

  // nodejs_heap_size_bytes
  const mem = process.memoryUsage();
  lines.push('# HELP nodejs_heap_used_bytes Node.js heap used bytes');
  lines.push('# TYPE nodejs_heap_used_bytes gauge');
  lines.push(`nodejs_heap_used_bytes ${mem.heapUsed}`);
  lines.push('# HELP nodejs_heap_total_bytes Node.js heap total bytes');
  lines.push('# TYPE nodejs_heap_total_bytes gauge');
  lines.push(`nodejs_heap_total_bytes ${mem.heapTotal}`);
  lines.push('# HELP nodejs_rss_bytes Node.js resident set size bytes');
  lines.push('# TYPE nodejs_rss_bytes gauge');
  lines.push(`nodejs_rss_bytes ${mem.rss}`);

  return lines.join('\n') + '\n';
}
