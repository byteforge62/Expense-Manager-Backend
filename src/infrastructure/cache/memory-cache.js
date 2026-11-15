const logger = require("../logger");

/**
 * Small in-process TTL cache used for genuinely repeated read-only work
 * (category metadata, expensive analytics snapshots).
 *
 * Deliberate constraints:
 * - Never the source of truth. Every cached value can be rebuilt from MongoDB.
 * - User scoped keys, so one user's data can never be served to another.
 * - Bounded entry count; expired entries are swept lazily.
 * - A cache failure degrades to a direct computation, never to an error.
 *
 * Redis is intentionally not a dependency: this backend is deployed as a
 * single container (see Dockerfile), so a network cache would add operational
 * cost without a current need. If the service is later scaled horizontally,
 * replace this module's internals with a shared cache; callers stay unchanged.
 */

const DEFAULT_TTL_MS = 30_000;
const MAX_ENTRIES = 500;

const store = new Map();

const stats = {
  hits: 0,
  misses: 0,
  invalidations: 0,
  errors: 0,
};

const isExpired = (entry) => entry.expiresAt <= Date.now();

const sweep = () => {
  const now = Date.now();

  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }

  // Bound memory even when nothing expires soon.
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    store.delete(oldestKey);
  }
};

const get = (key) => {
  const entry = store.get(key);

  if (!entry) {
    stats.misses += 1;
    return undefined;
  }

  if (isExpired(entry)) {
    store.delete(key);
    stats.misses += 1;
    return undefined;
  }

  stats.hits += 1;
  return entry.value;
};

const set = (key, value, ttlMs = DEFAULT_TTL_MS) => {
  if (store.size >= MAX_ENTRIES) {
    sweep();
  }

  store.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1, Number(ttlMs) || DEFAULT_TTL_MS),
  });
};

const del = (key) => {
  stats.invalidations += 1;
  return store.delete(key);
};

const delByPrefix = (prefix) => {
  let removed = 0;

  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed += 1;
    }
  }

  stats.invalidations += removed;
  return removed;
};

const clear = () => {
  store.clear();
};

/**
 * Returns the cached value or computes, stores and returns a fresh one.
 * Loader failures are never cached and always propagate to the caller.
 */
const getOrSet = async (key, ttlMs, loader) => {
  const cached = get(key);

  if (cached !== undefined) {
    return cached;
  }

  const value = await loader();
  set(key, value, ttlMs);
  return value;
};

/**
 * Invalidation must never break a request: a failed invalidation only costs
 * one stale read until the TTL expires.
 */
const safeInvalidate = (prefix) => {
  try {
    if (prefix) {
      return delByPrefix(prefix);
    }

    return 0;
  } catch (error) {
    stats.errors += 1;
    logger.warn("cache.invalidation_failed", { error });
    return 0;
  }
};

const getStats = () => ({
  ...stats,
  size: store.size,
  maxEntries: MAX_ENTRIES,
});

module.exports = {
  get,
  set,
  del,
  delByPrefix,
  clear,
  getOrSet,
  safeInvalidate,
  getStats,
  DEFAULT_TTL_MS,
};
