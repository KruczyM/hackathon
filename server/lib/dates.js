export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function today() {
  return new Date();
}

export function daysAgo(days, base = today()) {
  const date = new Date(base);
  date.setDate(date.getDate() - days);
  return date;
}

export function parseDays(value, fallback = 30) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 365);
}

export function dateRangeForDays(days, base = today()) {
  return {
    start: isoDate(daysAgo(days, base)),
    end: isoDate(base)
  };
}

export function toDate(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(" ", "T");
  const date = new Date(normalized.length === 10 ? `${normalized}T00:00:00Z` : normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isWithinRange(value, start, end) {
  const date = toDate(value);
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!date || !startDate || !endDate) return false;
  return date >= startDate && date <= new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1);
}

export function daysSince(value, base = today()) {
  const date = toDate(value);
  if (!date) return null;
  return Math.floor((base.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}
