'use strict';

/**
 * scripts/fullPipeline.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fully autonomous pipeline:
 *   1. Scrape Zolo + generate Gemini content  (lib/agent.js)
 *   2. Anomaly detection vs Firestore state   (lib/anomaly.js)
 *   3. Push to WordPress (skips on critical anomaly)
 *   4. Save run record + city state → Firestore  (lib/runHistory.js)
 *   5. Send alert email if any issues           (lib/alerts.js)
 *
 * Triggered by:
 *   - npm run pipeline             (manual / local)
 *   - GitHub Actions cron          (automated weekly)
 *
 * env: TRIGGERED_BY  ("github-actions" | "manual")
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { run: runAgent, TARGETS } = require('../lib/agent');
const { updateWordPressPage, isConfigured } = require('../lib/wordpress');
const { detectAnomalies, hasBlockingAnomalies } = require('../lib/anomaly');
const { saveRun, loadCityState, saveCityState } = require('../lib/runHistory');
const { sendAlertEmail } = require('../lib/alerts');

async function main() {
  const triggeredBy = process.env.TRIGGERED_BY || 'manual';
  const startedAt   = new Date().toISOString();

  // ── Check if agent is enabled in Firestore config ────────────────────────
  if (process.env.FIREBASE_PROJECT_ID) {
    try {
      const { loadAgentConfig } = require('../lib/runHistory');
      const agentConfig = await loadAgentConfig('market-trends');
      if (agentConfig && agentConfig.enabled === false) {
        console.log('[pipeline] Agent is disabled in config. Exiting.');
        process.exit(0);
      }
    } catch (err) {
      console.warn('[pipeline] Could not load agent config (continuing):', err.message);
    }
  }

  console.log(`\n[pipeline] ─── Full pipeline starting ────────────────────────`);
  console.log(`[pipeline] Triggered by: ${triggeredBy}`);
  console.log(`[pipeline] ───────────────────────────────────────────────────\n`);

  // ── Step 1: Scrape + Gemini ──────────────────────────────────────────────
  const results = await runAgent();

  // ── Step 2 & 3: Per-city anomaly check + WordPress push ──────────────────
  const cityRecords = [];

  for (const cityResult of results.cities) {
    const { city } = cityResult;
    const target   = TARGETS.find((t) => t.city === city);
    const pageId   = target ? process.env[target.wpPageIdEnvVar] : null;

    // ── Load last-known-good state ──────────────────────────────────────
    let prevState = null;
    try {
      prevState = await loadCityState(city);
    } catch (err) {
      console.warn(`[pipeline] Could not load Firestore state for ${city}: ${err.message}`);
    }

    // ── Detect anomalies ────────────────────────────────────────────────
    const anomalies = detectAnomalies(cityResult.stats, prevState?.lastGoodStats);
    const blocking  = hasBlockingAnomalies(anomalies);

    if (anomalies.length > 0) {
      console.warn(
        `[pipeline] ⚠ ${city} anomalies detected:\n` +
        anomalies.map((a) => `           [${a.severity}] ${a.message}`).join('\n')
      );
    }

    // ── Decide & execute WordPress push ────────────────────────────────
    let wpStatus = null;
    let wpError  = null;

    if (cityResult.status === 'scrape_error') {
      wpStatus = 'skipped_scrape_error';
      console.log(`[pipeline] ⚠ Skipping WP push for ${city}: scrape error`);
    } else if (blocking) {
      wpStatus = 'skipped_anomaly';
      console.log(`[pipeline] ⚠ Skipping WP push for ${city}: blocking anomaly`);
    } else if (!pageId) {
      wpStatus = 'skipped_no_page_id';
      console.log(`[pipeline] ⚠ Skipping WP push for ${city}: no page ID env var`);
    } else if (!isConfigured()) {
      wpStatus = 'skipped_not_configured';
      console.log(`[pipeline] ⚠ Skipping WP push for ${city}: WordPress not configured`);
    } else {
      try {
        const dateRange =
          cityResult.priceTables?.dateRange ||
          cityResult.stats?.dateRange        ||
          '';
        await updateWordPressPage(
          pageId, city, cityResult.stats, dateRange,
          cityResult.priceTables     || null,
          cityResult.inventoryTables || null
        );
        wpStatus = 'updated';
        console.log(`[pipeline] ✓ WordPress updated for ${city}`);

        // Persist the new stats as the reference for next run's anomaly check
        try {
          await saveCityState(city, cityResult.stats);
        } catch (err) {
          console.warn(`[pipeline] Could not save city state for ${city}: ${err.message}`);
        }
      } catch (err) {
        wpStatus = 'error';
        wpError  = err.message;
        console.error(`[pipeline] ✗ WP push failed for ${city}: ${err.message}`);
      }
    }

    cityRecords.push({
      city,
      status:       cityResult.status,
      wpStatus,
      avgSalePrice: cityResult.stats?.avgSalePrice ?? null,
      anomalies,
      error:        cityResult.error || wpError || null,
    });
  }

  // ── Step 4: Persist run record to Firestore ──────────────────────────────
  const pushOkCount  = cityRecords.filter((c) => c.wpStatus === 'updated').length;
  const overallStatus =
    results.status === 'failed'
      ? 'failed'
      : pushOkCount === TARGETS.length
        ? 'success'
        : 'partial';

  // Merge full city results with pipeline summary fields.
  // Strip large HTML fields (priceTables, inventoryTables) — they're only
  // needed for the WordPress push which already happened, and would push
  // the Firestore document over the 1MB limit.
  const fullCities = results.cities.map((cityResult) => {
    const summary = cityRecords.find((r) => r.city === cityResult.city) || {};
    const { priceTables, inventoryTables, rawStatCount, ...rest } = cityResult;
    return { ...rest, wpStatus: summary.wpStatus || null };
  });

  const runRecord = {
    agent:        'market-trends',
    triggeredBy,
    runAt:        new Date().toISOString(),
    startedAt,
    completedAt:  new Date().toISOString(),
    status:       overallStatus,
    summary:      `${pushOkCount}/${TARGETS.length} cities pushed to WordPress`,
    cities:       fullCities,
  };

  try {
    const docSize = JSON.stringify(runRecord).length;
    console.log(`[pipeline] Saving run record to Firestore (~${(docSize / 1024).toFixed(1)} KB)`);
    const runId = await saveRun(runRecord);
    console.log(`\n[pipeline] Run saved to Firestore (id: ${runId})`);
  } catch (err) {
    console.error(`[pipeline] ⚠ Firestore save failed: ${err.message}`);
  }

  // ── Step 5: Email alert if anything went wrong (or always in CI) ─────────
  const hasIssues = cityRecords.some(
    (c) => c.status !== 'success' || c.anomalies.length > 0 || c.wpStatus !== 'updated'
  );

  if (hasIssues || process.env.ALWAYS_SEND_REPORT === 'true') {
    await sendAlertEmail(runRecord);
  }

  console.log(`\n[pipeline] ─── Complete — ${runRecord.summary} ─────────────\n`);

  // Exit with failure code so GitHub Actions marks the run as failed
  if (overallStatus === 'failed') process.exit(1);
}

main().catch((err) => {
  console.error('[pipeline] Fatal error:', err);
  process.exit(1);
});
