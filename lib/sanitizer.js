/**
 * lib/sanitizer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cleans and validates scraped market data.
 * Same logic as functions/lib/sanitizer.js, adapted for local use.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const EXPECTED_KEYS = [
  "medianSalePrice",
  "avgSalePrice",
  "pricePerSqft",
  "daysOnMarket",
  "activeListings",
  "soldListings",
  "monthsOfInventory",
];

const SANITY_BOUNDS = {
  medianSalePrice:  { min: 50_000,  max: 50_000_000 },
  avgSalePrice:     { min: 50_000,  max: 50_000_000 },
  pricePerSqft:     { min: 10,      max: 50_000 },
  daysOnMarket:     { min: 0,       max: 3650 },
  activeListings:   { min: 0,       max: 1_000_000 },
  soldListings:     { min: 0,       max: 1_000_000 },
  monthsOfInventory:{ min: 0,       max: 120 },
};

function stripInvalid(stats) {
  const clean = {};
  for (const [k, v] of Object.entries(stats)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number" && !isFinite(v)) continue;
    clean[k] = v;
  }
  return clean;
}

function applySanityBounds(stats, city) {
  const result = { ...stats };
  const anomalies = [];
  for (const [key, bounds] of Object.entries(SANITY_BOUNDS)) {
    const val = result[key];
    if (val === undefined || val === null || typeof val !== "number") continue;
    if (val < bounds.min || val > bounds.max) {
      anomalies.push(`"${key}": ${val} out of bounds [${bounds.min}, ${bounds.max}]`);
      result[key] = null;
    }
  }
  if (anomalies.length) console.warn(`[sanitizer] ${city} anomalies:`, anomalies);
  return { stats: result, anomalies };
}

function checkExpected(stats, city) {
  const missing = EXPECTED_KEYS.filter((k) => stats[k] === undefined || stats[k] === null);
  if (missing.length) console.warn(`[sanitizer] ${city} missing keys: ${missing.join(", ")}`);
  return missing;
}

/**
 * Full sanitisation pipeline for one city's scraped stats.
 * @param {Object} rawStats
 * @param {string} city
 * @returns {{ cleanStats, anomalies, missingKeys }}
 */
function sanitize(rawStats, city) {
  let stats = stripInvalid(rawStats);
  const { stats: bounded, anomalies } = applySanityBounds(stats, city);
  stats = bounded;
  const missingKeys = checkExpected(stats, city);
  return { cleanStats: stats, anomalies, missingKeys };
}

module.exports = { sanitize, EXPECTED_KEYS };
