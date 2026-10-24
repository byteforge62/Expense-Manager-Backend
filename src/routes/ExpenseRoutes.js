const routes = require("express").Router();
const ExpenseController = require("../Controllers/ExepenseController");
const {requireAuth,requireRole} = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const {createExpenseSchema,updateExpenseSchema} = require("../validations/expense.validation");
const {idParamSchema} = require("../validations/common.validation");

routes.post("/expense", requireAuth, validate({body:createExpenseSchema}), ExpenseController.AddExpense);
routes.get("/expenses", requireAuth,requireRole("Admin"),ExpenseController.GetAllExpenses);
routes.get("/expense/:id", requireAuth, validate({params:idParamSchema}), ExpenseController.GetExpensebyID);
routes.put("/expense/:id", requireAuth, validate({params:idParamSchema,body:updateExpenseSchema}), ExpenseController.UpdateExpense);
routes.delete("/expense/:id", requireAuth,validate({params:idParamSchema}), ExpenseController.DeleteExpense);

routes.get("/expenses/me",requireAuth,ExpenseController.GetExpensebyUserId,);
routes.get("/expenses/recent",requireAuth,ExpenseController.GetRecentExpenses,);

module.exports = routes;
