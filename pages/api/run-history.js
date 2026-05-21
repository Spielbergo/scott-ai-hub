/**
 * pages/api/run-history.js
 * GET /api/run-history  →  returns the 20 most recent pipeline runs from Firestore.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // If Firebase isn't configured, return an empty list rather than crashing.
  if (!process.env.FIREBASE_PROJECT_ID) {
    return res.status(200).json({ runs: [] });
  }

  try {
    const { getRecentRuns } = require('../../lib/runHistory');
    const runs = await getRecentRuns(20);
    return res.status(200).json({ runs });
  } catch (err) {
    console.error('[run-history]', err.message);
    return res.status(500).json({ error: err.message, runs: [] });
  }
}
