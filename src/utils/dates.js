function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function fromUnixSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

function addBusinessDays(value, days) {
  const date = toDate(value);
  if (!date) return null;

  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  let remaining = Number(days) || 0;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }

  return result;
}

function maxDate(values) {
  let max = null;
  for (const value of values) {
    const date = toDate(value);
    if (date && (!max || date > max)) max = date;
  }
  return max;
}

function subtractMinutes(value, minutes) {
  const date = toDate(value) || new Date();
  return new Date(date.getTime() - (Number(minutes) || 0) * 60 * 1000);
}

function fallbackSince(days) {
  return new Date(Date.now() - (Number(days) || 30) * 24 * 60 * 60 * 1000);
}

module.exports = {
  toDate,
  toIso,
  fromUnixSeconds,
  addBusinessDays,
  maxDate,
  subtractMinutes,
  fallbackSince
};
