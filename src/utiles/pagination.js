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

module.exports = {
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  clampLimit,
  resolvePagination,
  buildPaginationMeta,
  encodeCursor,
  decodeCursor,
  buildCursorFilter,
  buildNextCursor,
};
