const {
  resolvePagination,
  buildPaginationMeta,
  encodeCursor,
  decodeCursor,
  buildCursorFilter,
  buildNextCursor,
  clampLimit,
} = require("../../src/utiles/list-query");

const { executeListQuery, buildSort, escapeRegex } = require("../../src/utiles/list-query");

describe("pagination helpers", () => {
  test("clamps limit to the hard maximum", () => {
    expect(clampLimit(5000)).toBe(100);
    expect(clampLimit(0)).toBe(20);
    expect(clampLimit("abc")).toBe(20);
    expect(clampLimit(7)).toBe(7);
  });

  test("resolves page, limit and skip", () => {
    expect(resolvePagination({ page: 3, limit: 25 })).toEqual({
      page: 3,
      limit: 25,
      skip: 50,
    });
    expect(resolvePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(resolvePagination({ page: -5 })).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  test("builds pagination metadata", () => {
    const meta = buildPaginationMeta({ page: 2, limit: 10, total: 35, requestId: "r1" });

    expect(meta).toEqual({
      pagination: {
        page: 2,
        limit: 10,
        total: 35,
        totalPages: 4,
        hasNextPage: true,
        hasPreviousPage: true,
      },
      requestId: "r1",
    });
  });

  test("round-trips a keyset cursor", () => {
    const date = new Date("2026-11-15T00:00:00.000Z");
    const cursor = encodeCursor({ _id: "507f1f77bcf86cd799439011", date });

    expect(decodeCursor(cursor)).toEqual({
      date,
      id: "507f1f77bcf86cd799439011",
    });
  });

  test("rejects malformed cursors instead of throwing", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(Buffer.from('{"d":"nope","i":"x"}').toString("base64url"))).toBeNull();
  });

  test("builds a strict keyset filter", () => {
    const date = new Date("2026-11-15T00:00:00.000Z");
    const cursor = encodeCursor({ _id: "507f1f77bcf86cd799439011", date });

    expect(buildCursorFilter(cursor, "date")).toEqual({
      $or: [
        { date: { $lt: date } },
        { date, _id: { $lt: "507f1f77bcf86cd799439011" } },
      ],
    });
  });

  test("derives the next cursor from the last row", () => {
    const cursor = buildNextCursor([
      { _id: "507f1f77bcf86cd799439011", date: new Date("2026-11-15T00:00:00.000Z") },
      { _id: "507f1f77bcf86cd799439012", date: new Date("2026-11-14T00:00:00.000Z") },
    ]);

    expect(decodeCursor(cursor)).toEqual({
      date: new Date("2026-11-14T00:00:00.000Z"),
      id: "507f1f77bcf86cd799439012",
    });
    expect(buildNextCursor([])).toBeNull();
  });
});

describe("list query execution", () => {
  const makeModel = (rows) => {
    const calls = { sort: null, limit: null, skip: null, selected: null, populated: null };

    const query = {
      select: jest.fn((value) => {
        calls.selected = value;
        return query;
      }),
      populate: jest.fn((value) => {
        calls.populated = value;
        return query;
      }),
      sort: jest.fn((value) => {
        calls.sort = value;
        return query;
      }),
      limit: jest.fn((value) => {
        calls.limit = value;
        return query;
      }),
      skip: jest.fn((value) => {
        calls.skip = value;
        return query;
      }),
      lean: jest.fn(() => query),
      exec: jest.fn(async () => rows),
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    };

    return {
      model: { find: jest.fn(() => query), countDocuments: jest.fn(async () => 42) },
      calls,
      query,
    };
  };

  test("legacy mode is capped and reports truncation", async () => {
    const { model, calls } = makeModel([{ _id: "1" }, { _id: "2" }, { _id: "3" }]);

    const result = await executeListQuery({
      model,
      filter: { userID: "u1" },
      sort: { date: -1, _id: -1 },
      params: {},
      legacyMax: 2,
    });

    expect(result.items).toHaveLength(2);
    expect(result.meta.pagination).toMatchObject({
      mode: "legacy",
      truncated: true,
      cap: 2,
      returned: 2,
    });
    // cap + 1 fetched so truncation is detectable without a count query.
    expect(calls.limit).toBe(3);
  });

  test("paginated mode uses skip/limit and returns totals", async () => {
    const { model, calls } = makeModel([{ _id: "1" }]);

    const result = await executeListQuery({
      model,
      filter: { userID: "u1" },
      sort: { date: -1, _id: -1 },
      params: { page: 2, limit: 10 },
    });

    expect(calls.skip).toBe(10);
    expect(calls.limit).toBe(10);
    expect(result.meta.pagination).toMatchObject({ page: 2, limit: 10, total: 42 });
    expect(result.meta.pagination).not.toHaveProperty("mode");
  });

  test("applies projection, population and no skip in cursor mode", async () => {
    const { model, calls } = makeModel([{ _id: "1" }]);
    const cursor = encodeCursor({
      _id: "507f1f77bcf86cd799439011",
      date: new Date("2026-11-15T00:00:00.000Z"),
    });

    const result = await executeListQuery({
      model,
      filter: { userID: "u1" },
      select: "amount date",
      populate: { path: "categoryID", select: "name" },
      sort: { date: -1, _id: -1 },
      params: { limit: 10, cursor },
      cursorField: "date",
    });

    expect(calls.selected).toBe("amount date");
    expect(calls.populated).toEqual({ path: "categoryID", select: "name" });
    expect(calls.skip).toBeNull();
    expect(model.countDocuments).not.toHaveBeenCalled();
    expect(result.meta.pagination).toMatchObject({ mode: "cursor", limit: 10 });
  });

  test("builds a deterministic sort and escapes search input", () => {
    expect(buildSort("amount", "asc", "date")).toEqual({ amount: 1, _id: 1 });
    expect(buildSort(undefined, "desc", "date")).toEqual({ date: -1, _id: -1 });
    expect(escapeRegex("a.b*c")).toBe("a\\.b\\*c");
  });
});
