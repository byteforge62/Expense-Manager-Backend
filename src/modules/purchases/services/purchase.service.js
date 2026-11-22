const mongoose = require("mongoose");

const PurchaseModel = require("../models/PurchaseModel");
const CategoryModel = require("../../../models/CategoryModel");

const expenseService = require("../../../services/expense.service");
const audit = require("../../../infrastructure/audit.service");
const logger = require("../../../infrastructure/logger");
const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} = require("../../../errors/AppError");
const {
  executeListQuery,
  buildSort,
  buildDateRangeFilter,
  escapeRegex,
} = require("../../../utiles/list-query");

/**
 * Purchase record service.
 *
 * Financial integration rules (the core of this module):
 * - a purchase is the authoritative record of the purchase event;
 * - at most one expense backs it (`linkedExpenseId`, unique index);
 * - editing the purchase updates that expense in place instead of adding one;
 * - deleting the purchase deletes its expense, so no orphan spend remains;
 * - the optional link is written after the purchase exists, so a failure can
 *   never leave an expense pointing at a missing purchase.
 */

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const totalFor = (unitPrice, quantity) =>
  roundMoney(Number(unitPrice) * Number(quantity));

const normalizeOptional = (value) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const buildExpenseDescription = (purchase) => {
  const parts = [`Purchase: ${purchase.name}`];

  if (purchase.merchant) {
    parts.push(purchase.merchant);
  }

  if (Number(purchase.quantity) > 1) {
    parts.push(`x${purchase.quantity}`);
  }

  return parts.join(" · ");
};

/**
 * Resolves the expense category a purchase should be booked under.
 *
 * An explicit id always wins. Otherwise the purchase's own category label is
 * matched against existing expense categories, then a conventional
 * "Purchases"/"Shopping" category, then any expense category. No category is
 * created here: categories are global admin-managed data.
 */
const resolveExpenseCategory = async (purchase, expenseCategoryID) => {
  if (expenseCategoryID) {
    const category = await CategoryModel.findOne({
      _id: expenseCategoryID,
      type: "expense",
    })
      .select("_id name")
      .lean();

    if (!category) {
      throw new ValidationError("Selected expense category does not exist");
    }

    return category;
  }

  const candidates = [purchase.category, "Purchases", "Shopping", "Other"].filter(
    Boolean,
  );

  for (const name of candidates) {
    const category = await CategoryModel.findOne({
      type: "expense",
      name: new RegExp(`^${escapeRegex(name)}$`, "i"),
    })
      .select("_id name")
      .lean();

    if (category) {
      return category;
    }
  }

  return CategoryModel.findOne({ type: "expense" }).select("_id name").lean();
};

const getPurchaseDocument = async (purchaseId, userId) => {
  const purchase = await PurchaseModel.findById(purchaseId);

  if (!purchase) {
    throw new NotFoundError("Purchase not found");
  }

  if (purchase.userID.toString() !== String(userId)) {
    throw new ForbiddenError("You are not authorized to access this purchase");
  }

  return purchase;
};

/**
 * Creates the linked expense for a purchase. Returns the expense id, or null
 * with a human-readable warning when the purchase has no expense category
 * available. Never throws: the purchase itself must still be saved.
 */
const linkExpense = async (purchase, expenseCategoryID, userId, context) => {
  const category = await resolveExpenseCategory(purchase, expenseCategoryID);

  if (!category) {
    return {
      linked: false,
      warning:
        "No expense category exists yet, so this purchase was saved without a linked expense.",
    };
  }

  const expense = await expenseService.addExpense(
    {
      categoryID: category._id,
      amount: purchase.totalAmount,
      date: purchase.purchaseDate,
      description: buildExpenseDescription(purchase),
    },
    userId,
    context,
  );

  purchase.linkedExpenseId = expense._id;
  await purchase.save();

  return { linked: true, expenseId: expense._id, category: category.name };
};

const createPurchase = async (data, userId, context = {}) => {
  const { syncExpense = false, expenseCategoryID, orderId, ...rest } = data;

  const purchase = new PurchaseModel({
    ...rest,
    orderId: normalizeOptional(orderId),
    userID: userId,
    quantity: rest.quantity ?? 1,
    purchaseDate: rest.purchaseDate ?? new Date(),
    totalAmount: totalFor(rest.unitPrice, rest.quantity ?? 1),
  });

  try {
    await purchase.save();
  } catch (error) {
    if (error?.code === 11000) {
      throw new ConflictError(
        "A purchase with this order ID already exists for your account",
      );
    }

    throw error;
  }

  audit.record({
    userID: userId,
    action: "purchase.created",
    description: "Purchase recorded",
    requestId: context.requestId,
    metadata: { purchaseId: String(purchase._id) },
  });

  let link = null;

  if (syncExpense) {
    try {
      link = await linkExpense(purchase, expenseCategoryID, userId, context);
    } catch (error) {
      logger.warn("purchase.expense_link_failed", {
        purchaseId: String(purchase._id),
        error,
      });
      link = {
        linked: false,
        warning:
          "The purchase was saved, but its expense could not be created. You can link it later.",
      };
    }
  }

  return {
    purchase: purchase.toObject(),
    warnings: link?.warning ? [link.warning] : [],
  };
};

const buildPurchaseFilter = (userId, filter = {}) => {
  const query = { userID: userId };
  const dateFilter = buildDateRangeFilter(
    "purchaseDate",
    filter.startDate,
    filter.endDate,
  );

  if (dateFilter) {
    Object.assign(query, dateFilter);
  }

  if (filter.category) {
    query.category = filter.category;
  }

  if (filter.merchant) {
    query.merchant = filter.merchant;
  }

  if (filter.status) {
    query.status = filter.status;
  }

  if (filter.search) {
    const pattern = { $regex: escapeRegex(filter.search), $options: "i" };
    query.$or = [
      { name: pattern },
      { merchant: pattern },
      { category: pattern },
      { sourceWebsite: pattern },
      { orderId: pattern },
      { description: pattern },
    ];
  }

  return query;
};

const listPurchases = async (userId, filter = {}) =>
  executeListQuery({
    model: PurchaseModel,
    filter: buildPurchaseFilter(userId, filter),
    sort: buildSort(filter.sortBy, filter.sortOrder, "purchaseDate"),
    params: filter,
  });

const getPurchase = async (purchaseId, userId) => {
  const purchase = await PurchaseModel.findOne({
    _id: purchaseId,
    userID: userId,
  }).lean();

  if (!purchase) {
    const exists = await PurchaseModel.exists({ _id: purchaseId });

    if (!exists) {
      throw new NotFoundError("Purchase not found");
    }

    throw new ForbiddenError("You are not authorized to access this purchase");
  }

  return purchase;
};

const updatePurchase = async (purchaseId, data, userId, context = {}) => {
  const purchase = await getPurchaseDocument(purchaseId, userId);
  const { syncExpense, expenseCategoryID, orderId, ...updates } = data;
  const warnings = [];

  if (orderId !== undefined) {
    updates.orderId = normalizeOptional(orderId);
  }

  // Explicit null clears an optional value; Mongoose would otherwise
  // validate it against the field type.
  Object.keys(updates).forEach((key) => {
    if (updates[key] === null) {
      updates[key] = undefined;
    }
  });

  const nextUnitPrice = updates.unitPrice ?? purchase.unitPrice;
  const nextQuantity = updates.quantity ?? purchase.quantity;

  Object.assign(purchase, updates);
  purchase.totalAmount = totalFor(nextUnitPrice, nextQuantity);

  if (purchase.status === "CANCELLED" && purchase.linkedExpenseId) {
    // A cancelled purchase is not spending: keep the records consistent by
    // removing the expense rather than leaving it counted.
    await removeLinkedExpense(purchase, userId, context);
    warnings.push(
      "The purchase is cancelled, so its linked expense was removed.",
    );
  }

  try {
    await purchase.save();
  } catch (error) {
    if (error?.code === 11000) {
      throw new ConflictError(
        "A purchase with this order ID already exists for your account",
      );
    }

    throw error;
  }

  // Keep the linked expense identical to the purchase it represents.
  if (purchase.linkedExpenseId && purchase.status !== "CANCELLED") {
    try {
      await expenseService.updateExpense(
        purchase.linkedExpenseId,
        {
          amount: purchase.totalAmount,
          date: purchase.purchaseDate,
          description: buildExpenseDescription(purchase),
        },
        userId,
        context,
      );
    } catch (error) {
      logger.warn("purchase.expense_sync_failed", {
        purchaseId: String(purchase._id),
        error,
      });
      warnings.push(
        "The purchase was updated, but its linked expense could not be synchronised.",
      );
    }
  }

  if (syncExpense === true && !purchase.linkedExpenseId && purchase.status !== "CANCELLED") {
    try {
      const link = await linkExpense(
        purchase,
        expenseCategoryID,
        userId,
        context,
      );

      if (link.warning) warnings.push(link.warning);
    } catch (error) {
      logger.warn("purchase.expense_link_failed", {
        purchaseId: String(purchase._id),
        error,
      });
      warnings.push("The purchase could not be linked to an expense.");
    }
  }

  if (syncExpense === false && purchase.linkedExpenseId) {
    await removeLinkedExpense(purchase, userId, context);
  }

  audit.record({
    userID: userId,
    action: "purchase.updated",
    description: "Purchase updated",
    requestId: context.requestId,
    metadata: { purchaseId: String(purchase._id) },
  });

  return { purchase: purchase.toObject(), warnings };
};

/**
 * Deletes the expense behind a purchase and clears the link.
 * The link is cleared first: if the expense delete fails the purchase is
 * unlinked (no duplicate spend), and the orphan is logged for follow-up.
 */
const removeLinkedExpense = async (purchase, userId, context) => {
  const expenseId = purchase.linkedExpenseId;

  if (!expenseId) {
    return;
  }

  purchase.linkedExpenseId = undefined;
  await purchase.save();

  try {
    await expenseService.deleteExpense(String(expenseId), userId, context);
  } catch (error) {
    logger.warn("purchase.linked_expense_delete_failed", {
      purchaseId: String(purchase._id),
      expenseId: String(expenseId),
      error,
    });
  }
};

const deletePurchase = async (purchaseId, userId, context = {}) => {
  const purchase = await PurchaseModel.findOneAndDelete({
    _id: purchaseId,
    userID: userId,
  });

  if (!purchase) {
    const exists = await PurchaseModel.exists({ _id: purchaseId });

    if (!exists) {
      throw new NotFoundError("Purchase not found");
    }

    throw new ForbiddenError("You are not authorized to delete this purchase");
  }

  if (purchase.linkedExpenseId) {
    try {
      await expenseService.deleteExpense(
        String(purchase.linkedExpenseId),
        userId,
        context,
      );
    } catch (error) {
      logger.warn("purchase.linked_expense_delete_failed", {
        purchaseId: String(purchase._id),
        error,
      });
    }
  }

  audit.record({
    userID: userId,
    action: "purchase.deleted",
    description: "Purchase deleted",
    requestId: context.requestId,
    metadata: { purchaseId: String(purchase._id) },
  });

  return purchase;
};

/**
 * Purchase analytics, computed once on the server with a single aggregation.
 *
 * The frontend renders these numbers as-is, so purchase totals on the page,
 * on the dashboard and in reports cannot drift apart.
 */
const getPurchaseSummary = async (userId, filter = {}) => {
  // The same filter builder as the list keeps analytics and the visible rows
  // describing the same set of purchases.
  const match = buildPurchaseFilter(userId, filter);
  match.userID = new mongoose.Types.ObjectId(String(userId));

  const [result] = await PurchaseModel.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              purchaseCount: { $sum: 1 },
              totalSpend: { $sum: "$totalAmount" },
              itemCount: { $sum: "$quantity" },
              averageSpend: { $avg: "$totalAmount" },
            },
          },
        ],
        byCategory: [
          { $group: { _id: "$category", spend: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
          { $sort: { spend: -1 } },
          { $limit: 25 },
        ],
        byMerchant: [
          { $group: { _id: "$merchant", spend: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
          { $sort: { spend: -1 } },
          { $limit: 10 },
        ],
        byMonth: [
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m", date: "$purchaseDate" } },
              spend: { $sum: "$totalAmount" },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: -1 } },
          { $limit: 12 },
          { $sort: { _id: 1 } },
        ],
        largest: [
          { $sort: { totalAmount: -1, purchaseDate: -1 } },
          { $limit: 5 },
          {
            $project: {
              name: 1,
              merchant: 1,
              totalAmount: 1,
              quantity: 1,
              purchaseDate: 1,
              imageUrl: 1,
              category: 1,
            },
          },
        ],
        recent: [
          { $sort: { purchaseDate: -1, _id: -1 } },
          { $limit: 5 },
          {
            $project: {
              name: 1,
              merchant: 1,
              totalAmount: 1,
              quantity: 1,
              purchaseDate: 1,
              imageUrl: 1,
              category: 1,
            },
          },
        ],
      },
    },
  ]);

  const totals = result?.totals?.[0] ?? {
    purchaseCount: 0,
    totalSpend: 0,
    itemCount: 0,
    averageSpend: 0,
  };

  const rename = (rows, key) =>
    rows.map((row) => ({
      [key]: row._id || "Unspecified",
      spend: roundMoney(row.spend),
      count: row.count,
    }));

  return {
    totals: {
      purchaseCount: totals.purchaseCount,
      totalSpend: roundMoney(totals.totalSpend),
      itemCount: totals.itemCount,
      averageSpend: roundMoney(totals.averageSpend || 0),
    },
    byCategory: rename(result?.byCategory ?? [], "category"),
    byMerchant: rename(result?.byMerchant ?? [], "merchant"),
    byMonth: (result?.byMonth ?? []).map((row) => ({
      month: row._id,
      spend: roundMoney(row.spend),
      count: row.count,
    })),
    largest: result?.largest ?? [],
    recent: result?.recent ?? [],
    range: {
      startDate: filter.startDate ?? null,
      endDate: filter.endDate ?? null,
    },
  };
};

module.exports = {
  createPurchase,
  listPurchases,
  getPurchase,
  updatePurchase,
  deletePurchase,
  getPurchaseSummary,
  totalFor,
  roundMoney,
};
