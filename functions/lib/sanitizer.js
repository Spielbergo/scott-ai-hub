/**
 * lib/sanitizer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cleans and validates market trend data extracted by the scraper.
 *
 * Responsibilities:
 *  1. Strip null / undefined / NaN values from a stats map
 *  2. Enforce expected numeric keys (warn if missing)
 *  3. Detect and remove statistical anomalies using the IQR method
 *     across a time-series of historical readings
 *  4. Return a clean, structured trend record ready for Firestore
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

/**
 * Keys we always expect to find on a Zolo trends page.
 * Warnings are emitted when these are absent.
 */
const EXPECTED_KEYS = [
  "medianSalePrice",
  "avgSalePrice",
  "pricePerSqft",
  "daysOnMarket",
  "activeListings",
  "soldListings",
  "monthsOfInventory",
];

/**
 * Maximum sane values for basic sanity-check filtering.
 * Values outside these bounds are treated as scrape artefacts.
 */
const SANITY_BOUNDS = {
  medianSalePrice: { min: 50_000, max: 50_000_000 },
  avgSalePrice: { min: 50_000, max: 50_000_000 },
  pricePerSqft: { min: 10, max: 50_000 },
  daysOnMarket: { min: 0, max: 3650 },      // up to 10 years is unusual but possible
  activeListings: { min: 0, max: 1_000_000 },
  soldListings: { min: 0, max: 1_000_000 },
  monthsOfInventory: { min: 0, max: 120 },
};

/**
 * Remove entries that are not finite numbers from a stats object.
 * Non-numeric string values (e.g. descriptive labels) are kept as-is
 * so we don't lose potentially useful information.
 *
 * @param {Object} stats  Raw stats map from scraper
 * @returns {Object} Filtered stats
 */
function stripInvalidNumeric(stats) {
  const clean = {};
  for (const [key, value] of Object.entries(stats)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "number" && !isFinite(value)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Apply hard sanity-bound filtering on known numeric keys.
 * Values outside SANITY_BOUNDS for a known key are set to null
 * and logged as anomalies.
 *
 * @param {Object} stats  Cleaned stats map
 * @param {string} city   City slug (for logging)
 * @returns {{ stats: Object, anomalies: string[] }}
 */
function applySanityBounds(stats, city) {
  const result = { ...stats };
  const anomalies = [];

  for (const [key, bounds] of Object.entries(SANITY_BOUNDS)) {
    const value = result[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number") continue;

    if (value < bounds.min || value > bounds.max) {
      anomalies.push(
        `[sanitizer] Anomaly detected in "${city}" — "${key}": ${value} is outside bounds [${bounds.min}, ${bounds.max}]. Nullified.`
      );
      result[key] = null;
    }
  }

  anomalies.forEach((msg) => console.warn(msg));
  return { stats: result, anomalies };
}

/**
 * Calculate the median of a numeric array.
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Detect outliers in a historical series using the IQR (interquartile range)
 * method with a 1.5× fence.
 *
 * @param {number[]} series  Ordered array of historical values (oldest → newest)
 * @returns {{ isOutlier: boolean, q1: number, q3: number, iqr: number }}
 */
function iqrOutlierCheck(series) {
  if (series.length < 4) return { isOutlier: false }; // Not enough data for IQR

  const sorted = [...series].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lowerHalf = sorted.slice(0, mid);
  const upperHalf = sorted.length % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);

  const q1 = median(lowerHalf);
  const q3 = median(upperHalf);
  const iqr = q3 - q1;

  const fence = 1.5 * iqr;
  const latest = series[series.length - 1];
  const isOutlier = latest < q1 - fence || latest > q3 + fence;

  return { isOutlier, q1, q3, iqr, lowerFence: q1 - fence, upperFence: q3 + fence, latest };
}

/**
 * Warn if expected stat keys are missing.
 * @param {Object} stats
 * @param {string} city
 * @returns {string[]} List of missing keys
 */
function checkExpectedKeys(stats, city) {
  const missing = EXPECTED_KEYS.filter((k) => stats[k] === undefined || stats[k] === null);
  if (missing.length > 0) {
    console.warn(`[sanitizer] "${city}" is missing expected keys: ${missing.join(", ")}`);
  }
  return missing;
}

/**
 * Full sanitisation pipeline for a single city's scraped stats.
 *
 * @param {Object} rawStats       Stats map from scraper
 * @param {string} city           City slug
 * @param {Object} [historicalStats]  Optional map of key → number[] (oldest → newest)
 *                                    used to run IQR anomaly detection across time series.
 * @returns {{
 *   cleanStats: Object,
 *   anomalies: string[],
 *   missingKeys: string[],
 *   iqrFlags: Object
 * }}
 */
function sanitize(rawStats, city, historicalStats = {}) {
  // Step 1: Remove null / NaN
  let stats = stripInvalidNumeric(rawStats);

  // Step 2: Hard bound checks
  const { stats: boundChecked, anomalies } = applySanityBounds(stats, city);
  stats = boundChecked;

  // Step 3: Expected-key audit
  const missingKeys = checkExpectedKeys(stats, city);

  // Step 4: IQR time-series anomaly detection
  const iqrFlags = {};
  for (const [key, historySeries] of Object.entries(historicalStats)) {
    const currentValue = stats[key];
    if (typeof currentValue !== "number") continue;

    const series = [...historySeries, currentValue];
    const check = iqrOutlierCheck(series);
    if (check.isOutlier) {
      iqrFlags[key] = check;
      console.warn(
        `[sanitizer] IQR outlier in "${city}" — "${key}": ${currentValue} ` +
        `(fences: [${check.lowerFence?.toFixed(2)}, ${check.upperFence?.toFixed(2)}]). Flagged but kept.`
      );
    }
  }

  return { cleanStats: stats, anomalies, missingKeys, iqrFlags };
}

module.exports = { sanitize, iqrOutlierCheck, EXPECTED_KEYS };
