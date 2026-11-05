const routes = require("express").Router();

const {
  requireAuth,
} = require("../../../middleware/auth.middleware");

const validate = require("../../../middleware/validate.middleware");

const controller = require("../controllers/financial-forecast.controller");

const {
  createForecastSchema,
} = require("../validations/financial-forecast.validation");

routes.use(requireAuth);

routes.post(
  "/",
  validate({ body: createForecastSchema }),
  controller.generateForecast,
);

module.exports = routes;