const routes = require("express").Router();

const { requireAuth } = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/validate.middleware");
const controller = require("../controllers/financial-intelligence.controller");
const { overviewQuerySchema } = require("../validations/financial-intelligence.validation");

routes.use(requireAuth);
routes.get("/overview", validate({ query: overviewQuerySchema }), controller.getOverview);

module.exports = routes;
