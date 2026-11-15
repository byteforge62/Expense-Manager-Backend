const asyncHandler = require("../../middleware/asyncHandler");
const { sendSuccess } = require("../../utiles/response");
const summaries = require("./summaries.service");

/**
 * Derived summary reads.
 *
 * Every response states that the payload is derived and rebuildable, so a
 * client never treats a cached aggregate as the financial record of truth.
 * Users can trigger a rebuild of their own summaries, which is also the
 * operator's repair path.
 */

const meta = (req, extra = {}) => ({
  ...extra,
  derived: true,
  source: "financial_summary",
  requestId: req.id,
});

const getDaily = asyncHandler(async (req, res) => {
  const items = await summaries.getSummaries(req.user.id, {
    periodType: "daily",
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
  });

  return sendSuccess(res, 200, "Daily summaries fetched successfully", items, meta(req));
});

const getMonthly = asyncHandler(async (req, res) => {
  const items = await summaries.getSummaries(req.user.id, {
    periodType: "monthly",
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
  });

  return sendSuccess(res, 200, "Monthly summaries fetched successfully", items, meta(req));
});

const getCategoryBreakdown = asyncHandler(async (req, res) => {
  const items = await summaries.getCategoryBreakdown(req.user.id, {
    periodType: "monthly",
    from: req.query.from,
    to: req.query.to,
  });

  return sendSuccess(
    res,
    200,
    "Category summaries fetched successfully",
    items,
    meta(req),
  );
});

const reconcile = asyncHandler(async (req, res) => {
  const { from, to } = req.body || {};
  const results = from || to
    ? await summaries.rebuildSummaries({ userID: req.user.id, from, to })
    : await summaries.rebuildAllForUser(req.user.id);

  return sendSuccess(res, 200, "Summaries rebuilt successfully", results, meta(req));
});

module.exports = {
  getDaily,
  getMonthly,
  getCategoryBreakdown,
  reconcile,
};
