const routes = require("express").Router();

const CategoryController = require("../Controllers/CategoryController");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");

const { idParamSchema } = require("../validations/common.validation");
const { createCategorySchema } = require("../validations/category.validation");

routes.post(
  "/categories",
  requireAuth,
  requireRole("Admin"),
  validate({ body: createCategorySchema }),
  CategoryController.AddCategory
);

routes.get(
  "/categories",
  requireAuth,
  CategoryController.GetAllCategory
);

routes.get(
  "/category/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  CategoryController.GetCategorybyID
);

routes.delete(
  "/categories/:id",
  requireAuth,
  requireRole("Admin"),
  validate({ params: idParamSchema }),
  CategoryController.DeleteCategory
);

module.exports = routes;