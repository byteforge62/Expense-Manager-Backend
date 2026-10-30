const express = require("express");
const router = express.Router();

const Recurring = require("../Controllers/RecurringController");
const { requireAuth } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");

const { idParamSchema } = require("../validations/common.validation");

const {
  createRecurringSchema,
  updateRecurringSchema,
} = require("../validations/recurring.validation");

router.post(
  "/recurring",
  requireAuth,
  validate({ body: createRecurringSchema }),
  Recurring.createRecurring
);

router.get(
  "/recurring/me",
  requireAuth,
  Recurring.getRecurringByUser
);

router.put(
  "/recurring/:id",
  requireAuth,
  validate({
    params: idParamSchema,
    body: updateRecurringSchema,
  }),
  Recurring.updateRecurring
);

router.delete(
  "/recurring/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  Recurring.deleteRecurring
);

router.get(
  "/recurring/upcoming",
  requireAuth,
  Recurring.getUpcomingRecurring
);

router.patch(
  "/recurring/toggle/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  Recurring.toggleRecurringStatus
);

module.exports = router;