const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_DAYS = 366;

const startOfUtcDay = (value) => {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const endOfUtcDay = (value) => new Date(startOfUtcDay(value).getTime() + DAY_MS - 1);

const getInclusiveDays = (startDate, endDate) =>
  Math.floor((startOfUtcDay(endDate) - startOfUtcDay(startDate)) / DAY_MS) + 1;

const getUtcDayKeys = (startDate, endDate) => {
  const days = getInclusiveDays(startDate, endDate);
  const start = startOfUtcDay(startDate);

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
    return date.toISOString().slice(0, 10);
  });
};

const normalizeDateWindow = (startDate, endDate, fallbackDays = 90, now = new Date()) => {
  const end = endDate ? new Date(endDate) : now;
  const start = startDate
    ? new Date(startDate)
    : new Date(startOfUtcDay(end).getTime() - (fallbackDays - 1) * DAY_MS);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new TypeError("startDate and endDate must be valid dates");
  }

  if (start > end) {
    throw new RangeError("startDate must be less than or equal to endDate");
  }

  const window = {
    start: startOfUtcDay(start),
    end: endOfUtcDay(end),
  };

  if (getInclusiveDays(window.start, window.end) > MAX_WINDOW_DAYS) {
    throw new RangeError(
      `The financial intelligence date range cannot exceed ${MAX_WINDOW_DAYS} calendar days`,
    );
  }

  return window;
};

const getComparableWindow = ({ start, end }) => {
  const days = getInclusiveDays(start, end);
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(
    startOfUtcDay(start).getTime() - days * DAY_MS,
  );

  return { start: previousStart, end: previousEnd };
};

module.exports = {
  DAY_MS,
  MAX_WINDOW_DAYS,
  endOfUtcDay,
  getComparableWindow,
  getInclusiveDays,
  getUtcDayKeys,
  normalizeDateWindow,
  startOfUtcDay,
};
