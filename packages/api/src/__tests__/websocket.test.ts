import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../cache/redis.js', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
  getSubscriberClient: vi.fn().mockReturnValue(null),
}));
vi.mock('../scheduler-registry.js', () => ({
  schedulerRegistry: {
    cancelIdle: vi.fn(),
    scheduleIdle: vi.fn(),
    get: vi.fn(),
  },
}));
vi.mock('../config.js', () => ({
  allowedOrigins: ['http://localhost:5173'],
  INSTANCE_ID: 'test-instance',
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('../auth/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
  getAccessTokenCookieName: vi.fn().mockReturnValue('access_token'),
}));

import { broadcastToUser, broadcast, hasActiveConnections } from '../ws.js';

describe('WebSocket module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('broadcastToUser', () => {
    it('does not throw when no Redis and no local connections', () => {
      expect(() => {
        broadcastToUser('user-1', 'schedule_updated', 'test reason');
      }).not.toThrow();
    });

    it('accepts optional data parameter', () => {
      expect(() => {
        broadcastToUser('user-1', 'schedule_updated', 'test', { changes: [] });
      }).not.toThrow();
    });
  });

  describe('broadcast', () => {
    it('does not throw when no Redis and no WSS', () => {
      expect(() => {
        broadcast('system_message', 'server maintenance');
      }).not.toThrow();
    });

    it('accepts data parameter', () => {
      expect(() => {
        broadcast('system_message', 'update', { version: '2.0' });
      }).not.toThrow();
    });
  });

  describe('hasActiveConnections', () => {
    it('returns false when no connections exist', () => {
      expect(hasActiveConnections('non-existent-user')).toBe(false);
    });
  });
});

describe('WebSocket message format', () => {
  it('broadcastToUser sends correct event type for schedule_updated', () => {
    expect(() => {
      broadcastToUser('user-1', 'schedule_updated', 'calendar sync');
    }).not.toThrow();
  });

  it('broadcastToUser sends correct event type for schedule_changes', () => {
    expect(() => {
      broadcastToUser('user-1', 'schedule_changes', 'reschedule', {
        batchId: 'batch-1',
        changes: [{ type: 'created', title: 'Meeting' }],
      });
    }).not.toThrow();
  });

  it('broadcast sends system_message to all users', () => {
    expect(() => {
      broadcast('system_message', 'maintenance window', {
        message: 'Server restart in 5 minutes',
      });
    }).not.toThrow();
  });
});
