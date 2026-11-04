
const PurchaseProduct = require("../models/PurchaseProductModel");
const IncomeModel = require("../../../models/IncomeModel");
const ExpenseModel = require("../../../models/ExpenseModel");
const BillModel = require("../../../models/BillModel");
const RecurringModel = require("../../../models/RecurringModel");
const NotFoundError = require("../../../errors/NotFoundError");
const ForbiddenError = require("../../../errors/ForbiddenError");
const { calculateAffordability } = require("../domain/affordability.engine");

const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYSIS_HISTORY_DAYS = 90;
const COMMITMENT_HORIZON_DAYS = 30;

const getPlatformFromUrl = (value) => {
  if (!value) return undefined;

  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
  }
};

const createProduct = async (data, userId) => {
  const { listing, ...productData } = data;
  const isPurchased = productData.status === "PURCHASED";

  const product = await PurchaseProduct.create({
    ...productData,
    userID: userId,
    purchasePrice: isPurchased
      ? productData.purchasePrice ?? productData.currentPrice
      : productData.purchasePrice,
    purchaseDate: isPurchased
      ? productData.purchaseDate ?? new Date()
      : productData.purchaseDate,
    listings: listing
      ? [
          {
            ...listing,
            platform:
              listing.platform ||
              getPlatformFromUrl(listing.url) ||
              "Unknown retailer",
          },
        ]
      : [],
    priceHistory: [
      {
        price: data.currentPrice,
        platform:
          listing?.platform || getPlatformFromUrl(listing?.url),
      },
    ],
  });

  return product;
};

const listProducts = async (userId) =>
  PurchaseProduct.find({ userID: userId })
    .sort({ updatedAt: -1 })
    .lean();

const getProduct = async (productId, userId) => {
  const product = await PurchaseProduct.findById(productId);

  if (!product) {
    throw new NotFoundError("Tracked product not found");
  }

  if (product.userID.toString() !== userId) {
    throw new ForbiddenError(
      "You are not authorized to access this product",
    );
  }

  return product;
};

const updateProduct = async (productId, data, userId) => {
  const product = await getProduct(productId, userId);
  const { listing, ...updates } = data;

  if (
    updates.currentPrice !== undefined &&
    updates.currentPrice !== product.currentPrice
  ) {
    product.lastAnalysis = null;

    product.priceHistory.push({
      price: updates.currentPrice,
      platform:
        listing?.platform ||
        getPlatformFromUrl(listing?.url) ||
        getPlatformFromUrl(product.productUrl),
    });

    if (product.priceHistory.length > 100) {
      product.priceHistory.splice(
        0,
        product.priceHistory.length - 100,
      );
    }
  }

  if (listing) {
    const platform =
      listing.platform ||
      getPlatformFromUrl(listing.url) ||
      "Unknown retailer";

    product.listings.push({ ...listing, platform });
    product.priceHistory.push({
      price: listing.price,
      platform,
    });
  }

  if (product.listings.length > 50) {
    product.listings.splice(0, product.listings.length - 50);
  }

  if (product.priceHistory.length > 100) {
    product.priceHistory.splice(
      0,
      product.priceHistory.length - 100,
    );
  }

  Object.assign(product, updates);

  if (product.status === "PURCHASED") {
    if (!product.purchaseDate) {
      product.purchaseDate = new Date();
    }

    if (
      product.purchasePrice === undefined ||
      product.purchasePrice === null
    ) {
      product.purchasePrice = product.currentPrice;
    }
  }

  await product.save();
  return product;
};

const deleteProduct = async (productId, userId) => {
  const product = await PurchaseProduct.findOneAndDelete({
    _id: productId,
    userID: userId,
  });

  if (!product) {
    const exists = await PurchaseProduct.exists({
      _id: productId,
    });

    if (!exists) {
      throw new NotFoundError("Tracked product not found");
    }

    throw new ForbiddenError(
      "You are not authorized to delete this product",
    );
  }
};

const analyzeProduct = async (
  productId,
  userId,
  availableCash,
  purchasePrice,
) => {
  const product = await getProduct(productId, userId);

  const now = new Date();

  const startDate = new Date(
    now.getTime() - ANALYSIS_HISTORY_DAYS * DAY_MS,
  );

  const commitmentHorizonEnd = new Date(
    now.getTime() + COMMITMENT_HORIZON_DAYS * DAY_MS,
  );

  const [
    incomeTransactions,
    expenseTransactions,
    pendingBills,
    recurringSchedules,
  ] = await Promise.all([
    IncomeModel.find({
      userID: userId,
      date: {
        $gte: startDate,
        $lte: now,
      },
    })
      .select("amount date +recurringId")
      .lean(),

    ExpenseModel.find({
      userID: userId,
      date: {
        $gte: startDate,
        $lte: now,
      },
    })
      .select("amount date +recurringId")
      .lean(),

    BillModel.find({
      userID: userId,
      status: "pending",
      dueDate: {
        $lte: commitmentHorizonEnd,
      },
      settledExpenseId: null,
    })
      .select("name amount dueDate")
      .lean(),

    RecurringModel.find({
      userId,
      isActive: true,
      type: {
        $in: ["INCOME", "EXPENSE"],
      },
    })
      .select("title amount type frequency nextDate")
      .lean(),
  ]);

  const analyzedPrice = purchasePrice ?? product.currentPrice;

  const result = calculateAffordability({
    availableCash,
    purchasePrice: analyzedPrice,
    incomeTransactions,
    expenseTransactions,
    pendingBills,
    recurringSchedules,
    now,
  });

  product.lastAnalysis = {
    availableCash,
    purchasePrice: analyzedPrice,
    result,
    analyzedAt: now,
  };

  await product.save();

  return {
    product,
    analysis: result,
  };
};

module.exports = {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  analyzeProduct,
};
