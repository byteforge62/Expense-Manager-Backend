const router = require("express").Router();
const { requireAuth } = require("../middleware/auth.middleware");
const { asyncHandler, sendSuccess } = require("../utiles/response");
const demoDataService = require("../services/demo-data.service");

/**
 * Demo workspace: fills the signed-in account with sample records so the user
 * can explore every page with real data. Live data is never touched: the
 * service refuses to seed an account that already has expenses.
 */

const seedDemoData = asyncHandler(async (req, res) => {
  const result = await demoDataService.seedDemoDataForUser(req.user.id);

  return sendSuccess(
    res,
    200,
    result.seeded
      ? "Demo data added to your account"
      : "This account already has expense records, so demo data was not added",
    result,
  );
});

router.post("/demo/seed", requireAuth, seedDemoData);

module.exports = router;
