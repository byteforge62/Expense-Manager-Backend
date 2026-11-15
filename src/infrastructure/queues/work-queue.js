/**
 * Bounded concurrency mapper.
 *
 * Background jobs frequently need to touch many users/schedules. Running them
 * sequentially is slow; running them all at once can exhaust the Mongo
 * connection pool. This keeps a fixed number of in-flight operations without
 * pulling in an external queue library.
 *
 * There is no persistence here by design: durable work lives in the outbox and
 * job-run collections. This is only the executor.
 */
const mapWithConcurrency = async (items, concurrency, worker) => {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, 32));

  const results = new Array(list.length);
 let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;

      if (index >= list.length) {
        return;
      }

      // A failing item must not abort the batch; the caller inspects results.
      try {
        results[index] = { ok: true, value: await worker(list[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  });

  await Promise.all(runners);

  const failures = results.filter((entry) => entry && entry.ok === false);

  return {
    results,
    failures,
    succeeded: results.length - failures.length,
    total: list.length,
  };
};

module.exports = {
  mapWithConcurrency,
};
