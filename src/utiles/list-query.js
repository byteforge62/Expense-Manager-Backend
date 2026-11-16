// --- Pagination primitives ---

const PAGE_LIMIT_DEFAULT = 20;
const PAGE_LIMIT_MAX = 100;

const clampLimit = (value, fallback = PAGE_LIMIT_DEFAULT) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), PAGE_LIMIT_MAX);
};

const resolvePagination = ({ page, limit } = {}) => {
  const parsedPage = Number(page);
  const safePage =
    Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const safeLimit = clampLimit(limit);

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
  };
};

const buildPaginationMeta = ({ page, limit, total, requestId }) => {
  const safeTotal = Number.isFinite(total) ? total : 0;
  const totalPages = limit > 0 ? Math.ceil(safeTotal / limit) : 0;

  return {
    pagination: {
      page,
      limit,
      total: safeTotal,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    ...(requestId ? { requestId } : {}),
  };
};

const encodeCursor = (document) => {
  if (!document || !document.date || !document._id) {
    return null;
  }

  const date = new Date(document.date);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return Buffer.from(
    JSON.stringify({ d: date.toISOString(), i: String(document._id) }),
    "utf8",
  ).toString("base64url");
};

const decodeCursor = (cursor) => {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 256) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const date = new Date(parsed.d);

    if (Number.isNaN(date.getTime()) || !/^[a-fA-F0-9]{24}$/.test(parsed.i || "")) {
      return null;
    }

    return { date, id: parsed.i };
  } catch {
    return null;
  }
};

/**
 * Keyset pagination filter for collections sorted by `date: -1, _id: -1`.
 * Keeps scanning bounded regardless of how deep the caller pages, unlike
 * skip/limit which degrades on large collections.
 */
const buildCursorFilter = (cursor, dateField = "date") => {
  const decoded = decodeCursor(cursor);

  if (!decoded) {
    return null;
  }

  return {
    $or: [
      { [dateField]: { $lt: decoded.date } },
      { [dateField]: decoded.date, _id: { $lt: decoded.id } },
    ],
  };
};

const buildNextCursor = (documents) => {
  if (!Array.isArray(documents) || documents.length === 0) {
    return null;
  }

  return encodeCursor(documents[documents.length - 1]);
};

/**
 * Shared list execution for every collection.
 *
 * Two modes, both bounded:
 * - legacy: no `page`/`limit`/`cursor` supplied. Returns the full array (what
 *   the current frontend expects) but capped by LEGACY_LIST_MAX so a large
 *   account can never produce an unbounded response.
 * - paginated: offset pagination with total counts, or keyset (cursor)
 *   pagination for large activity feeds where deep offsets are expensive.
 *
 * Always projects and returns plain objects: no Mongoose document hydration,
 * no accidental population of unrelated fields.
 */

const LEGACY_LIST_MAX = Number(process.env.LEGACY_LIST_MAX) || 2000;

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildDateRangeFilter = (field, startDate, endDate) => {
  if (!startDate && !endDate) {
    return null;
  }

  const range = {};

  if (startDate) {
    range.$gte = new Date(startDate);
  }

  if (endDate) {
    range.$lte = new Date(endDate);
  }

  return { [field]: range };
};

const buildSort = (sortBy, sortOrder, fallback = "date") => {
  const field = sortBy || fallback;
  const direction = sortOrder === "asc" ? 1 : -1;

  // Stable tiebreaker: identical values still paginate deterministically.
  return { [field]: direction, _id: direction };
};

const wantsPagination = (params = {}) =>
  params.page !== undefined ||
  params.limit !== undefined ||
  params.cursor !== undefined;

const executeListQuery = async ({
  model,
  filter,
  select,
  populate,
  sort,
  params = {},
  legacyMax = LEGACY_LIST_MAX,
  cursorField,
}) => {
  const applyCommon = (query) => {
    if (select) {
      query.select(select);
    }

    if (populate) {
      query.populate(populate);
    }

    return query;
  };

  if (!wantsPagination(params)) {
    const cap = Math.min(Number(legacyMax) || LEGACY_LIST_MAX, LEGACY_LIST_MAX);

    const docs = await applyCommon(model.find(filter))
      .sort(sort)
      .limit(cap + 1)
      .lean();

    const truncated = docs.length > cap;
    const items = truncated ? docs.slice(0, cap) : docs;

    return {
      items,
      meta: {
        pagination: {
          mode: "legacy",
          returned: items.length,
          truncated,
          cap,
          ...(truncated
            ? { notice: "Response truncated; request page/limit for full access" }
            : {}),
        },
        ...(params.requestId ? { requestId: params.requestId } : {}),
      },
    };
  }

  const { page, limit, skip } = resolvePagination(params);
  // `cursor` being present (even empty, meaning "first page") selects keyset
  // mode. An empty cursor sorts from the newest row without a filter, which is
  // how a client starts a cursor-paginated feed.
  const cursorMode = Boolean(cursorField) && params.cursor !== undefined;
  const cursorFilter = cursorMode ? buildCursorFilter(params.cursor, cursorField) : null;

  const effectiveFilter = cursorFilter
    ? { $and: [filter, cursorFilter] }
    : filter;

  const build = (queryFilter, useSkip) => {
    let query = applyCommon(model.find(queryFilter))
      .sort(sort)
      .limit(limit);

    if (useSkip) {
      query = query.skip(skip);
    }

    return query.lean();
  };

  const [items, total] = await Promise.all([
    build(effectiveFilter, !cursorMode).exec(),
    cursorMode ? Promise.resolve(null) : model.countDocuments(filter),
  ]);

  if (cursorMode) {
    return {
      items,
      meta: {
        pagination: {
          mode: "cursor",
          limit,
          hasNextPage: items.length === limit,
          nextCursor: items.length === limit ? buildNextCursor(items) : null,
        },
        ...(params.requestId ? { requestId: params.requestId } : {}),
      },
    };
  }

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total, requestId: params.requestId }),
  };
};

module.exports = {
  // Pagination primitives
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  clampLimit,
  resolvePagination,
  buildPaginationMeta,
  encodeCursor,
  decodeCursor,
  buildCursorFilter,
  buildNextCursor,
  // List execution
  LEGACY_LIST_MAX,
  escapeRegex,
  buildDateRangeFilter,
  buildSort,
  wantsPagination,
  executeListQuery,
};
