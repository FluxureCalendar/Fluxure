// Singleton WebSocket — opens on first subscribe(), closes when last listener unsubscribes.
// Reconnects with exponential backoff.
import { browser } from '$app/environment';
import { PUBLIC_API_URL } from '$env/static/public';
import {
  WS_INITIAL_RECONNECT_DELAY_MS,
  WS_MAX_RECONNECT_DELAY_MS,
  WS_CLOSE_TOO_MANY,
  WS_CAPACITY_MIN_RECONNECT_MS,
  WS_RECONNECT_JITTER_MS,
} from '@fluxure/shared';

type MessageHandler = (data: {
  type: string;
  reason: string;
  timestamp: string;
  changes?: unknown[];
  batchId?: string;
  changeCount?: number;
  data?: unknown;
}) => void;
export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting' | 'capacity';
type ConnectionStateHandler = (state: ConnectionState) => void;

let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = WS_INITIAL_RECONNECT_DELAY_MS;
const listeners = new Set<MessageHandler>();
const connectionListeners = new Set<ConnectionStateHandler>();
let currentState: ConnectionState = 'disconnected';

// Reconnect when tab becomes visible after being hidden
if (browser) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ws === null && listeners.size > 0) {
      connect();
    }
  });
}

function setConnectionState(state: ConnectionState): void {
  if (state === currentState) return;
  currentState = state;
  connectionListeners.forEach((handler) => handler(state));
}

function getWsUrl(): string {
  const apiUrl = PUBLIC_API_URL || '';
  if (apiUrl) {
    // Derive WS URL from API URL
    const url = new URL(apiUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    return url.toString();
  }
  // Same-origin fallback for dev or co-hosted deployments
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function connect(): void {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    reconnectDelay = WS_INITIAL_RECONNECT_DELAY_MS;
    setConnectionState('connected');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      listeners.forEach((handler) => handler(data));
      // Emit synthetic schedule_changes event for backward compatibility
      if (
        data.type === 'schedule_updated' &&
        Array.isArray(data.changes) &&
        data.changes.length > 0
      ) {
        const syntheticMsg = {
          type: 'schedule_changes',
          data: data.changes,
          reason: data.reason,
          timestamp: data.timestamp,
        };
        listeners.forEach((handler) => handler(syntheticMsg));
      }
    } catch {
      // Ignore non-JSON messages (pong, etc.)
    }
  };

  ws.onclose = (event) => {
    ws = null;

    // Server enforces per-user connection limit with a custom close code
    if (event.code === WS_CLOSE_TOO_MANY) {
      setConnectionState('capacity');
      reconnectDelay = Math.max(reconnectDelay, WS_CAPACITY_MIN_RECONNECT_MS);
      scheduleReconnect();
      return;
    }

    setConnectionState('reconnecting');
    scheduleReconnect();
  };

  ws.onerror = () => {
    // Browser fires onclose automatically after onerror
  };
}

function scheduleReconnect(): void {
  if (reconnectTimeout) return;
  // Delay doubles after scheduling so the first reconnect uses the initial 1s delay
  const jitter = Math.floor(Math.random() * WS_RECONNECT_JITTER_MS);
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    reconnectDelay = Math.min(reconnectDelay * 2, WS_MAX_RECONNECT_DELAY_MS);
    connect();
  }, reconnectDelay + jitter);
}

export function subscribe(handler: MessageHandler): () => void {
  if (!browser) return () => {};
  listeners.add(handler);
  if (listeners.size === 1) connect();

  return () => {
    listeners.delete(handler);
    if (listeners.size === 0 && connectionListeners.size === 0) disconnect();
  };
}

export function disconnect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  reconnectDelay = WS_INITIAL_RECONNECT_DELAY_MS;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  setConnectionState('disconnected');
}

type PlanUpdateHandler = (data: { plan: string; paymentStatus: string | null }) => void;
const planUpdateListeners = new Set<PlanUpdateHandler>();
let planWsUnsub: (() => void) | null = null;

/** Subscribe to plan_updated WebSocket events (billing changes, payment failures). */
export function subscribePlanUpdates(handler: PlanUpdateHandler): () => void {
  if (!browser) return () => {};

  planUpdateListeners.add(handler);

  // Wire into main WS listener on first plan subscriber
  if (planUpdateListeners.size === 1) {
    planWsUnsub = subscribe((msg) => {
      if (msg.type === 'plan_updated' && msg.data) {
        const payload = msg.data as { plan: string; paymentStatus: string | null };
        planUpdateListeners.forEach((h) => h(payload));
      }
    });
  }

  return () => {
    planUpdateListeners.delete(handler);
    if (planUpdateListeners.size === 0 && planWsUnsub) {
      planWsUnsub();
      planWsUnsub = null;
    }
  };
}

export function subscribeConnectionState(handler: ConnectionStateHandler): () => void {
  if (!browser) return () => {};
  connectionListeners.add(handler);
  // Initiate connection for state watchers, but respect any pending reconnect backoff
  if (ws === null && currentState !== 'connected' && !reconnectTimeout) {
    connect();
  }
  // Emit current state immediately to new subscriber
  handler(currentState);

  // Track browser online/offline events
  const onOffline = () => setConnectionState('disconnected');
  const onOnline = () => {
    if (ws === null) {
      setConnectionState('reconnecting');
      connect();
    }
  };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);

  return () => {
    connectionListeners.delete(handler);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    if (listeners.size === 0 && connectionListeners.size === 0) disconnect();
  };
}
