const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const safeDivide = (numerator, denominator, fallback = 0) => {
  if (!Number.isFinite(Number(numerator)) || !Number.isFinite(Number(denominator))) {
    return fallback;
  }

  if (Number(denominator) === 0) {
    return fallback;
  }

  return Number(numerator) / Number(denominator);
};

const median = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((first, second) => first - second);

  if (sorted.length === 0) {
    return 0;
  }

  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
};

const average = (values) => {
  const filtered = Array.isArray(values)
    ? values.map(Number).filter(Number.isFinite)
    : [];
  return filtered.length === 0
    ? 0
    : filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
};

const standardDeviation = (values) => {
  const filtered = Array.isArray(values)
    ? values.map(Number).filter(Number.isFinite)
    : [];

  if (filtered.length < 2) {
    return 0;
  }

  const mean = average(filtered);
  return Math.sqrt(
    filtered.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      filtered.length,
  );
};

const medianAbsoluteDeviation = (values) => {
  const filtered = Array.isArray(values)
    ? values.map(Number).filter(Number.isFinite)
    : [];

  if (filtered.length === 0) {
    return 0;
  }

  const center = median(filtered);
  return median(filtered.map((value) => Math.abs(value - center)));
};

const meanAbsoluteDeviation = (values) => {
  const filtered = Array.isArray(values)
    ? values.map(Number).filter(Number.isFinite)
    : [];

  if (filtered.length === 0) {
    return 0;
  }

  const mean = average(filtered);
  return average(filtered.map((value) => Math.abs(value - mean)));
};

const percentChange = (currentValue, baselineValue) => {
  const current = Number(currentValue || 0);
  const baseline = Number(baselineValue || 0);

  if (baseline === 0) {
    return current === 0 ? 0 : null;
  }

  return ((current - baseline) / Math.abs(baseline)) * 100;
};

const sumBy = (items, keySelector, valueSelector = (item) => Number(item.amount ?? 0)) => {
  const totals = {};

  for (const item of items) {
    const key = keySelector(item);
    const value = Number(valueSelector(item));
    if (Number.isFinite(value)) {
      totals[key] = (totals[key] || 0) + value;
    }
  }

  return totals;
};

const countBy = (items, keySelector) => {
  const counts = {};

  for (const item of items) {
    const key = keySelector(item);
    counts[key] = (counts[key] || 0) + 1;
  }

  return counts;
};

module.exports = {
  average,
  countBy,
  median,
  meanAbsoluteDeviation,
  medianAbsoluteDeviation,
  percentChange,
  roundMoney,
  safeDivide,
  standardDeviation,
  sumBy,
};
