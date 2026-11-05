const { MAX_RECURRING_OCCURRENCES } = require("./forecast.constants");

const isValidDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
};

const toDate = (value, fieldName) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);

  if (!isValidDate(date)) {
    throw new TypeError(`${fieldName} must be a valid date`);
  }

  return date;
};

const daysInUtcMonth = (year, month) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const getMonthStart = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const addCalendarMonths = (date, months) => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;

  const day = Math.min(
    date.getUTCDate(),
    daysInUtcMonth(targetYear, targetMonth),
  );

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
};

const addFrequency = (date, frequency, schedule) => {
  const current = toDate(date, "Recurring occurrence date");

  switch (frequency) {
    case "daily": {
      const next = new Date(current);
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    }

    case "weekly": {
      const next = new Date(current);
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    }

    case "monthly": {
      const nextMonth = current.getUTCMonth() + 1;
      const targetYear = current.getUTCFullYear() + Math.floor(nextMonth / 12);
      const targetMonth = nextMonth % 12;

      const anchorDay = Number.isInteger(schedule.recurrenceAnchorDay)
        ? schedule.recurrenceAnchorDay
        : current.getUTCDate();

      const day = Math.min(anchorDay, daysInUtcMonth(targetYear, targetMonth));

      return new Date(
        Date.UTC(
          targetYear,
          targetMonth,
          day,
          current.getUTCHours(),
          current.getUTCMinutes(),
          current.getUTCSeconds(),
          current.getUTCMilliseconds(),
        ),
      );
    }

    case "yearly": {
      const targetYear = current.getUTCFullYear() + 1;

      const anchorMonth = Number.isInteger(schedule.recurrenceAnchorMonth)
        ? schedule.recurrenceAnchorMonth
        : current.getUTCMonth();

      const anchorDay = Number.isInteger(schedule.recurrenceAnchorDay)
        ? schedule.recurrenceAnchorDay
        : current.getUTCDate();

      const day = Math.min(anchorDay, daysInUtcMonth(targetYear, anchorMonth));

      return new Date(
        Date.UTC(
          targetYear,
          anchorMonth,
          day,
          current.getUTCHours(),
          current.getUTCMinutes(),
          current.getUTCSeconds(),
          current.getUTCMilliseconds(),
        ),
      );
    }

    default:
      throw new TypeError(`Unsupported recurring frequency: ${frequency}`);
  }
};

const getRecurringOccurrences = ({
  schedule,
  startDate,
  endDate,
  maxOccurrences = MAX_RECURRING_OCCURRENCES,
}) => {
  if (!schedule || typeof schedule !== "object") {
    throw new TypeError("A recurring schedule is required");
  }

  const start = toDate(startDate, "Forecast start date");
  const end = toDate(endDate, "Forecast end date");

  if (end <= start) {
    throw new RangeError("Forecast end date must be after start date");
  }

  if (!Number.isInteger(maxOccurrences) || maxOccurrences < 1) {
    throw new RangeError("maxOccurrences must be a positive integer");
  }

  if (!["daily", "weekly", "monthly", "yearly"].includes(schedule.frequency)) {
    throw new TypeError("Recurring schedule has an unsupported frequency");
  }

  let occurrence = toDate(schedule.nextDate, "Recurring nextDate");
  let iterations = 0;

  while (occurrence < start) {
    if (iterations >= maxOccurrences) {
      throw new RangeError(
        `Recurring schedule ${schedule._id || schedule.title || ""} exceeds the occurrence calculation limit`,
      );
    }

    occurrence = addFrequency(occurrence, schedule.frequency, schedule);
    iterations += 1;
  }

  const occurrences = [];

  while (occurrence < end) {
    if (occurrences.length >= maxOccurrences) {
      throw new RangeError(
        `Recurring schedule ${schedule._id || schedule.title || ""} exceeds the occurrence calculation limit`,
      );
    }

    occurrences.push({
      date: new Date(occurrence),
      amount: Number(schedule.amount),
      type: schedule.type,
      title: schedule.title,
      scheduleId: schedule._id ? String(schedule._id) : undefined,
    });

    occurrence = addFrequency(occurrence, schedule.frequency, schedule);
  }

  return occurrences;
};

module.exports = {
  isValidDate,
  toDate,
  getMonthStart,
  addCalendarMonths,
  addFrequency,
  getRecurringOccurrences,
};
