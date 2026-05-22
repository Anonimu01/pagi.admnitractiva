// src/utils/normalize.js

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return num;
}

module.exports = {
  normalizeNumber,
};
