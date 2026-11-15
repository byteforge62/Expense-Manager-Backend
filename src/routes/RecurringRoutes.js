const router = require("express").Router();
const { z } = require("zod");

const Recurring = require("../Controllers/RecurringController");
const { requireAuth } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const idempotency = require("../middleware/idempotency.middleware");

const { idParamSchema } = require("../validations/common.validation");
const { recurringListQuerySchema } = require("../validations/query.validation");

const {
  createRecurringSchema,
  updateRecurringSchema,
} = require("../validations/recurring.validation");

const upcomingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.post(
  "/recurring",
  requireAuth,
  validate({ body: createRecurringSchema }),
  idempotency(),
  Recurring.createRecurring
);

router.get(
  "/recurring/me",
  requireAuth,
  validate({ query: recurringListQuerySchema }),
  Recurring.getRecurringByUser
);

router.put(
  "/recurring/:id",
  requireAuth,
  validate({
    params: idParamSchema,
    body: updateRecurringSchema,
  }),
  idempotency(),
  Recurring.updateRecurring
);

router.delete(
  "/recurring/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  idempotency(),
  Recurring.deleteRecurring
);

router.get(
  "/recurring/upcoming",
  requireAuth,
  validate({ query: upcomingQuerySchema }),
  Recurring.getUpcomingRecurring
);

router.patch(
  "/recurring/toggle/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  idempotency(),
  Recurring.toggleRecurringStatus
);

module.exports = router;
