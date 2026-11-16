const CategoryService = require("../services/category.service")
const { asyncHandler } = require("../utiles/response");
const {sendSuccess} = require("../utiles/response");
const AddCategory = asyncHandler(async (req, res) => {
  const category = await CategoryService.addCategory(req.body);

  return sendSuccess(res, 201, "Category added successfully", category);
});

const GetAllCategory = asyncHandler(async (req, res) => {
  const categories = await CategoryService.getAllCategory();

  return sendSuccess(res, 200, "Categories fetched successfully", categories);
});

const GetCategorybyID = asyncHandler(async (req, res) => {
  const category = await CategoryService.getCategoryById(req.params.id);

  return sendSuccess(
    res,
    200,
    "Category found successfully",
    category
  );
});

const DeleteCategory = asyncHandler(async (req, res) => {
  await CategoryService.deleteCategory(req.params.id);

  return sendSuccess(
    res,
    200,
    "Category deleted successfully"
  );
});
module.exports = {
  AddCategory,
  GetAllCategory,
  GetCategorybyID,
  DeleteCategory,
};
