'use strict';

/**
 * lib/runHistory.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Firestore helpers for run history and per-city state.
 *
 * Collections:
 *   runs/          – one doc per pipeline execution
 *   cityState/     – one doc per city, tracks last-known-good stats
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { getDb } = require('./firebase');

const RUNS_COLLECTION        = 'runs';
const CITY_STATE_COLLECTION  = 'cityState';
const AGENT_CONFIG_COLLECTION = 'agentConfig';

// ── Run records ───────────────────────────────────────────────────────────────

/**
 * Persist a completed pipeline run to Firestore.
 * @param {Object} runRecord
 * @returns {Promise<string>} Firestore document ID
 */
async function saveRun(runRecord) {
  const db  = getDb();
  const ref = await db.collection(RUNS_COLLECTION).add({
    ...runRecord,
    createdAt: new Date(),
  });
  return ref.id;
}

/**
 * Fetch the N most recent run records for the dashboard.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getRecentRuns(limit = 20) {
  const db       = getDb();
  const snapshot = await db
    .collection(RUNS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => serializeDoc(doc));
}

// ── City state ────────────────────────────────────────────────────────────────

/**
 * Load the last-known-good stats for a city.
 * @param {string} city
 * @returns {Promise<Object|null>}
 */
async function loadCityState(city) {
  const db  = getDb();
  const doc = await db.collection(CITY_STATE_COLLECTION).doc(city).get();
  return doc.exists ? serializeDoc(doc) : null;
}

/**
 * Overwrite a city's state with the stats from a successful run.
 * @param {string} city
 * @param {Object} stats
 */
async function saveCityState(city, stats) {
  const db = getDb();
  await db
    .collection(CITY_STATE_COLLECTION)
    .doc(city)
    .set(
      {
        city,
        lastGoodStats: stats,
        lastGoodRunAt: new Date(),
        updatedAt:     new Date(),
      },
      { merge: true }
    );
}

// ── Internal ──────────────────────────────────────────────────────────────────

/** Convert a Firestore DocumentSnapshot to a plain JSON-safe object. */
function serializeDoc(doc) {
  const data = doc.data();
  return { id: doc.id, ...convertTimestamps(data) };
}

/** Recursively turn Firestore Timestamps into ISO strings. */
function convertTimestamps(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj.toDate instanceof Function) return obj.toDate().toISOString();
  if (Array.isArray(obj)) return obj.map(convertTimestamps);
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, convertTimestamps(v)])
    );
  }
  return obj;
}

// ── Agent config ─────────────────────────────────────────────────────────────

/**
 * Load agent config (enabled flag, schedule) from Firestore.
 * @param {string} agentId  e.g. 'market-trends'
 * @returns {Promise<Object|null>}
 */
async function loadAgentConfig(agentId) {
  try {
    const db  = getDb();
    const doc = await db.collection(AGENT_CONFIG_COLLECTION).doc(agentId).get();
    return doc.exists ? serializeDoc(doc) : null;
  } catch (err) {
    console.error('loadAgentConfig error:', err.message);
    return null;
  }
}

/**
 * Persist agent config to Firestore (merge).
 * @param {string} agentId
 * @param {Object} config  e.g. { enabled, schedule }
 */
async function saveAgentConfig(agentId, config) {
  const db = getDb();
  await db
    .collection(AGENT_CONFIG_COLLECTION)
    .doc(agentId)
    .set({ ...config, updatedAt: new Date() }, { merge: true });
}

module.exports = { saveRun, getRecentRuns, loadCityState, saveCityState, loadAgentConfig, saveAgentConfig };
