const RecurringModel = require("../models/RecurringModel");
const NotFoundError = require("../errors/NotFoundError");
const ForbiddenError = require("../errors/ForbiddenError");


const createRecurring = async (data, userId) => {
  const recurringData = {
    ...data,
    userId,
  };

  return await RecurringModel.create(recurringData);
};

const getRecurringByUser = async (userId) => {
  return await RecurringModel.find({
    userId,
  });
};

const deleteRecurring = async (id, userId) => {
  const recurring = await RecurringModel.findOneAndDelete({
    _id: id,
    userId,
  });

  if (!recurring) {
    const exists = await RecurringModel.exists({ _id: id });

    if (!exists) {
      throw new NotFoundError("Recurring transaction not found");
    }

    throw new ForbiddenError(
      "You are not authorized to delete this recurring transaction"
    );
  }
};

const updateRecurring = async (id, data, userId) => {
  const updatedRecurring = await RecurringModel.findOneAndUpdate(
    {
      _id: id,
      userId,
    },
    {
      $set: data,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!updatedRecurring) {
    const exists = await RecurringModel.exists({ _id: id });

    if (!exists) {
      throw new NotFoundError("Recurring transaction not found");
    }

    throw new ForbiddenError(
      "You are not authorized to update this recurring transaction",
    );
  }

  return updatedRecurring;
};

const getUpcomingRecurring = async (userId) => {
  return await RecurringModel.find({
    userId,
    nextDate: {
      $gte: new Date(),
    },
  })
    .sort({ nextDate: 1 })
    .limit(5);
};

const toggleRecurringStatus = async (id, userId) => {
  const recurring = await RecurringModel.findOne({
    _id: id,
    userId,
  });

  if (!recurring) {
    const exists = await RecurringModel.exists({ _id: id });

    if (!exists) {
      throw new NotFoundError("Recurring transaction not found");
    }

    throw new ForbiddenError(
      "You are not authorized to update this recurring transaction"
    );
  }

  recurring.isActive = !recurring.isActive;

  await recurring.save();

  return recurring;
};


module.exports = {
    createRecurring,
    getRecurringByUser,
    deleteRecurring,
    updateRecurring,
    getUpcomingRecurring,
    toggleRecurringStatus
}