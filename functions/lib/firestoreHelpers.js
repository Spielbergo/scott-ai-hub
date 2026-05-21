/**
 * lib/firestoreHelpers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Helper functions for reading and writing market trend data to Firestore.
 *
 * Firestore schema used by the Market Trend Agent:
 *
 *  marketTrends/
 *    {city}/                       ← document per city (e.g. "toronto")
 *      latest: {                   ← most recent clean snapshot
 *        scrapedAt, stats, anomalies, iqrFlags, missingKeys
 *      }
 *      history/                    ← sub-collection of weekly snapshots
 *        {YYYY-WW}/               ← document keyed by ISO year-week
 *          scrapedAt, stats, anomalies, iqrFlags, missingKeys
 *
 *  agentStatus/
 *    marketTrendAnalyst/           ← current run status
 *      lastRunAt, lastRunStatus, citiesProcessed, citiesSucceeded
 *
 *  agentLogs/
 *    {auto-id}/                    ← one doc per agent run
 *      agent, runAt, status, citiesProcessed, citiesSucceeded, summary
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const admin = require("firebase-admin");

/**
 * Returns the ISO year-week string for a given Date, e.g. "2024-W21".
 * Week 1 is the week containing the first Thursday of the year (ISO 8601).
 * @param {Date} date
 * @returns {string}
 */
function isoYearWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Make Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Persist a single city's sanitised result to Firestore.
 *
 * Writes to:
 *  - marketTrends/{city}             (latest snapshot, merged)
 *  - marketTrends/{city}/history/{week}  (historical archive)
 *
 * @param {string} city
 * @param {{scrapedAt: string, cleanStats: Object, anomalies: string[], iqrFlags: Object, missingKeys: string[]}} result
 * @returns {Promise<void>}
 */
async function saveCityTrend(city, result) {
  const db = admin.firestore();
  const now = new Date(result.scrapedAt || new Date().toISOString());
  const weekKey = isoYearWeek(now);

  const payload = {
    scrapedAt: result.scrapedAt,
    stats: result.cleanStats,
    anomaliesCount: (result.anomalies || []).length,
    iqrFlaggedKeys: Object.keys(result.iqrFlags || {}),
    missingKeys: result.missingKeys || [],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const cityRef = db.collection("marketTrends").doc(city);
  const historyRef = cityRef.collection("history").doc(weekKey);

  // Batch write for atomicity
  const batch = db.batch();
  batch.set(cityRef, { latest: payload }, { merge: true });
  batch.set(historyRef, payload);
  await batch.commit();

  console.log(`[firestore] Saved trends for "${city}" (week ${weekKey}).`);
}

/**
 * Load the last N weeks of historical stats for a city.
 * Used to supply the IQR anomaly detector with a baseline series.
 *
 * @param {string} city
 * @param {number} [weeksBack=12]
 * @returns {Promise<Object>}  Map of statKey → number[] (oldest → newest)
 */
async function loadHistoricalStats(city, weeksBack = 12) {
  const db = admin.firestore();
  const historyRef = db
    .collection("marketTrends")
    .doc(city)
    .collection("history")
    .orderBy("scrapedAt", "desc")
    .limit(weeksBack);

  const snapshot = await historyRef.get();
  if (snapshot.empty) return {};

  // Collect docs oldest → newest
  const docs = snapshot.docs.map((d) => d.data()).reverse();
  const historicalStats = {};

  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc.stats || {})) {
      if (typeof value !== "number") continue;
      if (!historicalStats[key]) historicalStats[key] = [];
      historicalStats[key].push(value);
    }
  }

  return historicalStats;
}

/**
 * Update the agentStatus document for the Market Trend Analyst.
 * @param {{ lastRunAt: string, lastRunStatus: string, citiesProcessed: number, citiesSucceeded: number }} status
 * @returns {Promise<void>}
 */
async function updateAgentStatus(status) {
  const db = admin.firestore();
  await db.collection("agentStatus").doc("marketTrendAnalyst").set(
    {
      ...status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Append a run log entry to agentLogs.
 * @param {Object} logEntry
 * @returns {Promise<string>} Auto-generated document ID
 */
async function appendAgentLog(logEntry) {
  const db = admin.firestore();
  const ref = await db.collection("agentLogs").add({
    ...logEntry,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

module.exports = { saveCityTrend, loadHistoricalStats, updateAgentStatus, appendAgentLog, isoYearWeek };
