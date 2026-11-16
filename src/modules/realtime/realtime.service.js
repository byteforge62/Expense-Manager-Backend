const events = require("../../infrastructure/events/event-bus");
const EVENTS = require("../../infrastructure/events/event-names");

const logger = require("../../infrastructure/logger");

/**
 * Server-Sent Events delivery.
 *
 * Chosen over WebSockets because the product only needs server -> client
 * notifications (one direction) and SSE works through the existing Express
 * deployment with no extra infrastructure, proxy upgrade configuration or
 * sticky sessions.
 *
 * Isolation guarantees:
 * - Connections are keyed by the authenticated user id, never by a
 *   client-supplied value.
 * - `publishToUser` writes only to that user's connections, so financial data
 *   can never cross accounts.
 * - Each connection is capped per user; the oldest is closed when the cap is
 *   exceeded, bounding memory per account.
 */

const HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS) || 25_000;
const MAX_CONNECTIONS_PER_USER = Number(process.env.SSE_MAX_CONNECTIONS) || 5;

const connections = new Map(); // userId -> Set<{id, res, connectedAt}>
let heartbeatTimer = null;

const stats = {
  totalConnections: 0,
  totalPublished: 0,
  droppedPublishes: 0,
};

const writeEvent = (res, event, data) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const closeConnection = (userId, entry) => {
  const set = connections.get(userId);

  if (!set) {
    return;
  }

  set.delete(entry);

  if (set.size === 0) {
    connections.delete(userId);
  }

  try {
    entry.res.end();
  } catch {
    // Already closed by the client.
  }
};

const addConnection = (userId, res) => {
  const key = String(userId);

  if (!connections.has(key)) {
    connections.set(key, new Set());
  }

  const set = connections.get(key);
  const entry = { res, connectedAt: Date.now() };

  set.add(entry);
  stats.totalConnections += 1;

  while (set.size > MAX_CONNECTIONS_PER_USER) {
    const oldest = set.values().next().value;
    closeConnection(key, oldest);
  }

  return entry;
};

const removeConnection = (userId, entry) => {
  const key = String(userId);
  const set = connections.get(key);

  if (!set) {
    return;
  }

  set.delete(entry);

  if (set.size === 0) {
    connections.delete(key);
  }
};

/**
 * Publishes a domain update to a single user. Never throws: a broken browser
 * connection must not fail the financial request that produced the update.
 */
const publishToUser = (userId, event, data = {}) => {
  const set = connections.get(String(userId));

  if (!set || set.size === 0) {
    return 0;
  }

  const payload = { event, data, at: new Date().toISOString() };
  let delivered = 0;

  for (const entry of [...set]) {
    try {
      writeEvent(entry.res, event, payload);
      delivered += 1;
      stats.totalPublished += 1;
    } catch (error) {
      stats.droppedPublishes += 1;
      removeConnection(userId, entry);
      logger.debug("sse.publish_failed", { error });
    }
  }

  return delivered;
};

const startHeartbeat = () => {
  if (heartbeatTimer) {
    return;
  }

  heartbeatTimer = setInterval(() => {
    for (const [userId, set] of connections) {
      for (const entry of [...set]) {
        try {
          // Comment frames keep proxies from idling the stream closed.
          entry.res.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          removeConnection(userId, entry);
        }
      }
    }
  }, HEARTBEAT_MS);

  heartbeatTimer.unref?.();
};

const stopHeartbeat = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};

const closeAll = () => {
  for (const [userId, set] of [...connections]) {
    for (const entry of [...set]) {
      closeConnection(userId, entry);
    }
  }

  connections.clear();
  stopHeartbeat();
};

const getStats = () => ({
  ...stats,
  activeUsers: connections.size,
  activeConnections: [...connections.values()].reduce((sum, set) => sum + set.size, 0),
  heartbeatActive: Boolean(heartbeatTimer),
});

/**
 * Pushes domain changes to connected clients.
 *
 * Only user-scoped events are forwarded, and only to that user's connections.
 * Payloads carry identifiers and timestamps rather than full financial
 * records, so a client is told what changed and refetches through the normal
 * authenticated API.
 */
const USER_SCOPED_EVENTS = [
  EVENTS.EXPENSE_CREATED,
  EVENTS.EXPENSE_UPDATED,
  EVENTS.EXPENSE_DELETED,
  EVENTS.INCOME_CREATED,
  EVENTS.INCOME_DELETED,
  EVENTS.BUDGET_THRESHOLD_REACHED,
  EVENTS.BUDGET_PERIOD_ENDED,
  EVENTS.BILL_DUE_SOON,
  EVENTS.BILL_OVERDUE,
  EVENTS.BILL_SETTLED,
  EVENTS.RECURRING_TRANSACTION_PROCESSED,
  EVENTS.FINANCIAL_SUMMARY_UPDATED,
  EVENTS.FINANCIAL_INTELLIGENCE_GENERATED,
  EVENTS.NOTIFICATION_CREATED,
];

const register = () => {
  for (const eventName of USER_SCOPED_EVENTS) {
    events.register(
      eventName,
      async (payload) => {
        if (!payload?.userId) {
          return;
        }

        publishToUser(payload.userId, eventName, {
          ...payload,
          // Never forward large nested analytics payloads over the stream.
          recommendations: undefined,
          rules: undefined,
        });
      },
      { id: `realtime:${eventName}` },
    );
  }
};

module.exports = {
  addConnection,
  register,
  USER_SCOPED_EVENTS,
  removeConnection,
  publishToUser,
  startHeartbeat,
  stopHeartbeat,
  closeAll,
  getStats,
  MAX_CONNECTIONS_PER_USER,
};
