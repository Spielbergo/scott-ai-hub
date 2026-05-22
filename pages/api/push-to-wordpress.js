/**
 * pages/api/push-to-wordpress.js
 * POST { city: "Caledon" }  →  reads latest run from Firestore for that city and pushes to WP.
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { city } = req.body || {};
  if (!city) {
    return res.status(400).json({ error: "city is required" });
  }

  const { TARGETS } = require("../../lib/agent");
  const { updateWordPressPage, isConfigured } = require("../../lib/wordpress");
  const { detectAnomalies } = require("../../lib/anomaly");
  const { getRecentRuns, loadCityState, saveCityState, saveRun } = require("../../lib/runHistory");

  if (!isConfigured()) {
    return res.status(503).json({
      error: "WordPress credentials not configured (WP_SITE_URL / WP_USERNAME / WP_APP_PASSWORD missing)",
    });
  }

  // ── Load latest run from Firestore that contains this city ───────────────
  // Search the last 5 runs so a single-city manual-push record doesn't shadow
  // the full pipeline run.
  let cityResult;
  let runAt;
  try {
    const runs = await getRecentRuns(5);
    if (!runs?.length) {
      return res.status(404).json({ error: "No agent results found. Run the agent first." });
    }
    for (const run of runs) {
      const found = run.cities?.find((c) => c.city === city && c.stats && Object.keys(c.stats).length > 0);
      if (found) { cityResult = found; runAt = run.runAt; break; }
    }
  } catch (err) {
    return res.status(500).json({ error: `Failed to load results from Firestore: ${err.message}` });
  }

  if (!cityResult) {
    return res.status(404).json({ error: `City "${city}" not found in recent results. Run the agent first.` });
  }
  if (!cityResult.stats || Object.keys(cityResult.stats).length === 0) {
    return res.status(422).json({ error: `No stats available for "${city}". Re-run the agent.` });
  }

  const target = TARGETS.find((t) => t.city === city);
  const pageId = target && process.env[target.wpPageIdEnvVar];
  if (!pageId) {
    return res.status(503).json({
      error: `WordPress page ID not set (${target?.wpPageIdEnvVar} missing from env)`,
    });
  }

  // ── Anomaly detection ────────────────────────────────────────────────────
  let prevStats = null;
  try {
    const state = await loadCityState(city);
    prevStats = state?.lastGoodStats ?? null;
  } catch {
    // Firestore unavailable — proceed without comparison
  }

  const anomalies = detectAnomalies(cityResult.stats, prevStats);
  // Manual dashboard pushes don't hard-block on anomalies — the user can
  // see the data and is explicitly choosing to push.  The automated pipeline
  // is the right place to enforce the anomaly gate.

  // ── Push to WordPress ────────────────────────────────────────────────────
  // Note: priceTables / inventoryTables are stripped before Firestore save
  // to stay under the 1MB limit, so we pass null here.
  let wpStatus = "updated";
  try {
    const dateRange = cityResult.stats.dateRange || "";
    await updateWordPressPage(pageId, city, cityResult.stats, dateRange, null, null);
  } catch (err) {
    wpStatus = "error";
    console.error(`[push-to-wordpress] ${city}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }

  // ── Record result to Firestore (best-effort) ─────────────────────────────
  try {
    await saveCityState(city, cityResult.stats);
    await saveRun({
      agent:       "market-trends",
      triggeredBy: "dashboard-manual",
      startedAt:   runAt,
      completedAt: new Date().toISOString(),
      status:      "success",
      summary:     `Manual WP push for ${city}`,
      cities: [{
        city,
        status:      cityResult.status,
        wpStatus,
        avgSalePrice: cityResult.stats?.avgSalePrice ?? null,
        anomalies,
        error:        null,
      }],
    });
  } catch (err) {
    console.warn(`[push-to-wordpress] Firestore record failed: ${err.message}`);
  }

  return res.status(200).json({ ok: true, city, pageId, anomalies });
}
