/**
 * agents/marketTrendAnalyst.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Worker 1: The Market Trend Data Analyst
 *
 * Responsibilities:
 *  - Runs on a configurable weekly schedule (default: every Monday at 6 AM EST)
 *  - Reads target cities from Firebase environment config or fallback list
 *  - Scrapes Zolo.ca market statistics pages for each city
 *  - Sanitises the raw data, strips anomalies, applies IQR checks vs. history
 *  - Writes the clean results to Firestore (latest + weekly history archive)
 *  - Updates the agentStatus record
 *  - Appends a structured run log
 *  - Posts an executive summary report to the Slack channel
 *
 * Exported:
 *  - marketTrendScheduled  → Firebase Scheduled Function (pub/sub cron)
 *  - marketTrendHttp       → Firebase HTTPS Function (manual trigger / testing)
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const { scrapeCities } = require("../lib/scraper");
const { sanitize } = require("../lib/sanitizer");
const { saveCityTrend, loadHistoricalStats, updateAgentStatus, appendAgentLog } = require("../lib/firestoreHelpers");
const { sendMarketTrendReport, sendErrorAlert } = require("../lib/slack");

// ── Secret parameters (stored in Firebase Secret Manager) ────────────────────
const slackWebhookUrl = defineSecret("SLACK_WEBHOOK_URL");

// ── Default city list (override via Firebase Remote Config or env) ────────────
const DEFAULT_CITIES = [
  "toronto",
  "vancouver",
  "calgary",
  "edmonton",
  "ottawa",
];

/**
 * Core agent logic — shared between scheduled and HTTP triggers.
 *
 * @param {string[]} cities         City slugs to process
 * @param {string}   webhookUrl     Slack webhook URL (may be empty)
 * @returns {Promise<Object>}       Summary report object
 */
async function runMarketTrendAgent(cities, webhookUrl) {
  const runAt = new Date().toISOString();
  console.log(`[marketTrendAnalyst] Starting run at ${runAt} for cities: ${cities.join(", ")}`);

  await updateAgentStatus({
    lastRunAt: runAt,
    lastRunStatus: "running",
    citiesProcessed: cities.length,
    citiesSucceeded: 0,
  });

  // ── Step 1: Scrape all cities ─────────────────────────────────────────────
  const scrapeResults = await scrapeCities(cities);

  // ── Step 2: Sanitise + persist each city ─────────────────────────────────
  const cityResults = [];
  let citiesSucceeded = 0;

  for (const scrapeResult of scrapeResults) {
    const { city, stats: rawStats, scrapedAt, error } = scrapeResult;

    if (error) {
      console.error(`[marketTrendAnalyst] Skipping "${city}" — scrape error: ${error}`);
      cityResults.push({ city, error, cleanStats: {}, anomalies: [], iqrFlags: {}, missingKeys: [] });
      continue;
    }

    try {
      // Load historical baseline for IQR checks
      const historicalStats = await loadHistoricalStats(city, 12);

      // Sanitise
      const { cleanStats, anomalies, missingKeys, iqrFlags } = sanitize(rawStats, city, historicalStats);

      // Persist to Firestore
      await saveCityTrend(city, { scrapedAt, cleanStats, anomalies, iqrFlags, missingKeys });

      cityResults.push({ city, cleanStats, anomalies, iqrFlags, missingKeys });
      citiesSucceeded++;
    } catch (saveErr) {
      console.error(`[marketTrendAnalyst] Failed to persist "${city}": ${saveErr.message}`);
      cityResults.push({ city, error: saveErr.message, cleanStats: {}, anomalies: [], iqrFlags: {}, missingKeys: [] });
    }
  }

  // ── Step 3: Build summary report ─────────────────────────────────────────
  const report = {
    runAt,
    citiesProcessed: cities.length,
    citiesSucceeded,
    cityResults,
  };

  const finalStatus = citiesSucceeded === cities.length ? "success"
    : citiesSucceeded > 0 ? "partial"
    : "failed";

  // ── Step 4: Update agent status + log ────────────────────────────────────
  await updateAgentStatus({
    lastRunAt: runAt,
    lastRunStatus: finalStatus,
    citiesProcessed: cities.length,
    citiesSucceeded,
  });

  await appendAgentLog({
    agent: "marketTrendAnalyst",
    runAt,
    status: finalStatus,
    citiesProcessed: cities.length,
    citiesSucceeded,
    summary: `Processed ${cities.length} cities, ${citiesSucceeded} succeeded.`,
  });

  // ── Step 5: Slack report ──────────────────────────────────────────────────
  await sendMarketTrendReport(webhookUrl, report);

  console.log(`[marketTrendAnalyst] Run complete. Status: ${finalStatus} (${citiesSucceeded}/${cities.length})`);
  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled trigger — every Monday at 6:00 AM America/Toronto
// ─────────────────────────────────────────────────────────────────────────────
const marketTrendScheduled = onSchedule(
  {
    schedule: "every monday 06:00",
    timeZone: "America/Toronto",
    timeoutSeconds: 540,   // 9 minutes max
    memory: "512MiB",
    secrets: [slackWebhookUrl],
  },
  async (_event) => {
    // Initialise Admin SDK (idempotent)
    if (!admin.apps.length) admin.initializeApp();

    const cities = DEFAULT_CITIES;
    const webhookUrl = slackWebhookUrl.value();

    try {
      await runMarketTrendAgent(cities, webhookUrl);
    } catch (err) {
      console.error(`[marketTrendAnalyst] Fatal error: ${err.message}`, err);
      await sendErrorAlert(webhookUrl, "Market Trend Analyst", err.message);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// HTTP trigger — manual run / testing endpoint
// POST /marketTrendHttp
// Body (optional): { "cities": ["toronto", "vancouver"] }
// Requires the "x-admin-key" header to match ADMIN_KEY secret
// ─────────────────────────────────────────────────────────────────────────────
const adminKey = defineSecret("ADMIN_KEY");

const marketTrendHttp = onRequest(
  {
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [slackWebhookUrl, adminKey],
  },
  async (req, res) => {
    // Initialise Admin SDK (idempotent)
    if (!admin.apps.length) admin.initializeApp();

    // ── Simple secret-key auth guard ─────────────────────────────────────
    const providedKey = req.headers["x-admin-key"];
    const expectedKey = adminKey.value();
    if (!providedKey || providedKey !== expectedKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // ── Only allow POST ───────────────────────────────────────────────────
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    const requestedCities = Array.isArray(req.body?.cities) && req.body.cities.length > 0
      ? req.body.cities.map((c) => String(c).toLowerCase().trim())
      : DEFAULT_CITIES;

    const webhookUrl = slackWebhookUrl.value();

    try {
      const report = await runMarketTrendAgent(requestedCities, webhookUrl);
      res.status(200).json({
        status: "ok",
        citiesProcessed: report.citiesProcessed,
        citiesSucceeded: report.citiesSucceeded,
        runAt: report.runAt,
      });
    } catch (err) {
      console.error(`[marketTrendAnalyst] HTTP trigger fatal error: ${err.message}`, err);
      await sendErrorAlert(webhookUrl, "Market Trend Analyst (HTTP)", err.message);
      res.status(500).json({ error: "Internal server error", message: err.message });
    }
  }
);

module.exports = { marketTrendScheduled, marketTrendHttp };
