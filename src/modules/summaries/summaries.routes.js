const router = require("express").Router();
const { z } = require("zod");
const { requireAuth } = require("../../middleware/auth.middleware");
const validate = require("../../middleware/validate.middleware");
const { summariesQuerySchema } = require("../../validations/query.validation");
const controller = require("./summaries.controller");

const reconcileSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();

router.use(requireAuth);

router.get("/daily", validate({ query: summariesQuerySchema }), controller.getDaily);
router.get("/monthly", validate({ query: summariesQuerySchema }), controller.getMonthly);
router.get(
  "/category",
  validate({ query: summariesQuerySchema }),
  controller.getCategoryBreakdown,
);
router.post("/reconcile", validate({ body: reconcileSchema }), controller.reconcile);

module.exports = router;
