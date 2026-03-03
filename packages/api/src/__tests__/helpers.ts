import express from 'express';

const TEST_API_KEY = 'test-api-key-12345';
const TEST_USER_ID = 'test-user-id';

/**
 * Creates a minimal Express app with JSON parsing and auth middleware,
 * mounting the given router at /api/<prefix>.
 */
export function createTestApp(prefix: string, router: express.Router): express.Express {
  const app = express();
  app.use(express.json());

  // Auth middleware — sets req.userId for all requests (simulates JWT auth)
  app.use('/api', (req, _res, next) => {
    req.userId = TEST_USER_ID;
    req.userEmail = 'test@example.com';
    req.userPlan = 'free';
    next();
  });

  app.use(`/api/${prefix}`, router);
  return app;
}

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_API_KEY}` };
}

export { TEST_API_KEY, TEST_USER_ID };
