const CategoryModel = require("../models/CategoryModel");
const ConflictError = require("../errors/ConflictError");
const NotFoundError = require("../errors/NotFoundError");
const cache = require("../infrastructure/cache/memory-cache");

/**
 * Category metadata is global, read on nearly every page and written rarely,
 * which makes it the one safe cache candidate in this codebase. The cache is
 * invalidated on every write and expires quickly, so a stale category name can
 * never outlive a minute.
 */
const CATEGORY_CACHE_KEY = "categories:all";
const CATEGORY_CACHE_TTL_MS = 60_000;

const addCategory = async (data) => {
  const existing = await CategoryModel.findOne({
    name: data.name,
    type: data.type,
  }).lean();

  if (existing) {
    throw new ConflictError("Category already exists");
  }

  const category = await CategoryModel.create(data);

  cache.del(CATEGORY_CACHE_KEY);

  return category;
};

const getAllCategory = async () => {
  const cached = cache.get(CATEGORY_CACHE_KEY);

  if (cached) {
    return cached;
  }

  const categories = await CategoryModel.find()
    .select("name type createdAt")
    .sort({ name: 1 })
    .lean();

  cache.set(CATEGORY_CACHE_KEY, categories, CATEGORY_CACHE_TTL_MS);

  return categories;
};

const getCategoryById = async (id) => {
  const category = await CategoryModel.findById(id).lean();

  if (!category) {
    throw new NotFoundError("Category not found");
  }

  return category;
};

const deleteCategory = async (id) => {
  const category = await CategoryModel.findByIdAndDelete(id);

  if (!category) {
    throw new NotFoundError("Category not found");
  }

  cache.del(CATEGORY_CACHE_KEY);
};

const invalidateCache = () => cache.del(CATEGORY_CACHE_KEY);

module.exports = {
  addCategory,
  getAllCategory,
  getCategoryById,
  deleteCategory,
  invalidateCache,
};
