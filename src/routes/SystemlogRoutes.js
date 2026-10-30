const routes = require("express").Router();

const { getLogs } = require("../Controllers/SystemlogController");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");

routes.get("/logs", requireAuth, requireRole("Admin"), getLogs);

module.exports = routes;
