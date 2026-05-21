'use strict';

/**
 * lib/anomaly.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Anomaly detection for scraped market stats.
 *
 * A "critical" anomaly blocks the WordPress push entirely.
 * A "warning" anomaly is logged / emailed but still allows the push.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const REQUIRED_FIELDS    = ['avgSalePrice', 'monthlyChange', 'activeListings', 'daysOnMarket'];
const MAX_PRICE_CHANGE_PCT = 30;   // flag if price moves more than 30% vs last run
const MIN_PRICE           = 100_000;
const MAX_PRICE           = 10_000_000;

/**
 * Analyse scraped stats and return an array of anomaly objects.
 *
 * @param {Object|null} stats      – freshly scraped (and sanitised) stats
 * @param {Object|null} prevStats  – last-known-good stats from Firestore (optional)
 * @returns {{ severity: 'critical'|'warning', message: string }[]}
 */
function detectAnomalies(stats, prevStats = null) {
  const anomalies = [];

  // ── Empty result ──────────────────────────────────────────────────────────
  if (!stats || Object.keys(stats).length === 0) {
    anomalies.push({ severity: 'critical', message: 'No stats were scraped' });
    return anomalies;
  }

  // ── Missing required fields ───────────────────────────────────────────────
  for (const field of REQUIRED_FIELDS) {
    if (stats[field] == null) {
      anomalies.push({ severity: 'critical', message: `Missing required field: ${field}` });
    }
  }

  // ── Implausible price ─────────────────────────────────────────────────────
  if (stats.avgSalePrice != null) {
    if (stats.avgSalePrice < MIN_PRICE) {
      anomalies.push({
        severity: 'critical',
        message:  `Average price implausibly low: $${stats.avgSalePrice.toLocaleString('en-CA')}`,
      });
    }
    if (stats.avgSalePrice > MAX_PRICE) {
      anomalies.push({
        severity: 'critical',
        message:  `Average price implausibly high: $${stats.avgSalePrice.toLocaleString('en-CA')}`,
      });
    }
  }

  // ── Large price swing vs previous run ────────────────────────────────────
  if (prevStats?.avgSalePrice && stats.avgSalePrice) {
    const changePct =
      Math.abs((stats.avgSalePrice - prevStats.avgSalePrice) / prevStats.avgSalePrice) * 100;
    if (changePct > MAX_PRICE_CHANGE_PCT) {
      anomalies.push({
        severity: 'warning',
        message:  `Price changed ${changePct.toFixed(1)}% from last run ` +
                  `($${prevStats.avgSalePrice.toLocaleString('en-CA')} → ` +
                  `$${stats.avgSalePrice.toLocaleString('en-CA')})`,
      });
    }
  }

  // ── Zero listings ─────────────────────────────────────────────────────────
  if (stats.activeListings === 0) {
    anomalies.push({ severity: 'warning', message: 'Active listings is 0 — possible scrape failure' });
  }

  return anomalies;
}

/**
 * Returns true when at least one anomaly has severity "critical",
 * meaning the WordPress push should be blocked.
 *
 * @param {{ severity: string }[]} anomalies
 */
function hasBlockingAnomalies(anomalies) {
  return anomalies.some((a) => a.severity === 'critical');
}

module.exports = { detectAnomalies, hasBlockingAnomalies };
