/**
 * lib/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Core Market Trend Agent logic.
 *
 * Orchestrates: Scrape → Sanitise → Gemini → Save to data/results.json
 *
 * Used by:
 *   - scripts/runAgent.js  (CLI runner)
 *   - pages/api/run-agent.js  (Next.js API route / dashboard trigger)
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const path = require("path");
const fs   = require("fs");

const { scrapeTargets } = require("./scraper");
const { sanitize }      = require("./sanitizer");
const { generateMarketContent } = require("./gemini");

// ── Target cities configuration ───────────────────────────────────────────────
const TARGETS = [
  {
    city:          "Orangeville",
    zoloUrl:       "https://www.zolo.ca/orangeville-real-estate/trends",
    wpUrl:         "https://www.jenjewell.ca/ontario/orangeville/orangeville-realtors/",
    wpPageIdEnvVar: "WP_PAGE_ID_ORANGEVILLE",
  },
  {
    city:          "Caledon",
    zoloUrl:       "https://www.zolo.ca/caledon-real-estate/trends",
    wpUrl:         "https://www.jenjewell.ca/average-house-prices-in-caledon/",
    wpPageIdEnvVar: "WP_PAGE_ID_CALEDON",
  },
  {
    city:          "Shelburne",
    zoloUrl:       "https://www.zolo.ca/shelburne-real-estate/shelburne/trends",
    wpUrl:         "https://www.jenjewell.ca/average-house-prices-in-shelburne/",
    wpPageIdEnvVar: "WP_PAGE_ID_SHELBURNE",
  },
];

const RESULTS_PATH = path.resolve(__dirname, "../data/results.json");

/**
 * Run the full market trend agent pipeline.
 * @returns {Promise<Object>} Full results object (also written to data/results.json)
 */
async function run() {
  const runAt = new Date().toISOString();
  console.log(`\n[agent] Market Trend Agent starting — ${runAt}`);

  // ── Step 1: Scrape all three Zolo pages ──────────────────────────────────
  console.log("[agent] Step 1/3 — Scraping Zolo pages…");
  const scrapeInputs = TARGETS.map((t) => ({ url: t.zoloUrl, label: t.city }));
  const scrapeResults = await scrapeTargets(scrapeInputs);

  // ── Step 2 & 3: Sanitise + Gemini content generation per city ────────────
  console.log("[agent] Step 2/3 — Sanitising data and generating content with Gemini…");
  const cities = [];

  for (let i = 0; i < TARGETS.length; i++) {
    const target      = TARGETS[i];
    const scrapeResult = scrapeResults[i];

    const cityResult = {
      city:    target.city,
      zoloUrl: target.zoloUrl,
      wpUrl:   target.wpUrl,
      status:  "success",
    };

    if (scrapeResult.error) {
      cityResult.status = "scrape_error";
      cityResult.error  = scrapeResult.error;
      cityResult.stats  = {};
      cities.push(cityResult);
      continue;
    }

    // Sanitise
    const { cleanStats, anomalies, missingKeys } = sanitize(scrapeResult.stats, target.city);
    cityResult.scrapedAt      = scrapeResult.scrapedAt;
    cityResult.stats          = cleanStats;
    cityResult.rawStatCount   = scrapeResult.rawStatCount;
    cityResult.anomalies      = anomalies;
    cityResult.missingKeys    = missingKeys;
    cityResult.priceTables    = scrapeResult.priceTables    || null;
    cityResult.inventoryTables = scrapeResult.inventoryTables || null;

    // Gemini content generation
    try {
      console.log(`[agent]   Generating content for ${target.city}…`);
      const aiContent = await generateMarketContent(
        target.city,
        cleanStats,
        target.zoloUrl,
        target.wpUrl
      );
      cityResult.aiContent = aiContent;
      console.log(`[agent]   ✓ ${target.city} done`);
    } catch (err) {
      console.error(`[agent]   ✗ Gemini failed for ${target.city}: ${err.message}`);
      cityResult.aiError  = err.message;
      cityResult.status   = "ai_error";
    }

    cities.push(cityResult);
  }

  // ── Step 4: Build summary and persist ────────────────────────────────────
  const succeeded = cities.filter((c) => c.status === "success").length;
  const overallStatus =
    succeeded === TARGETS.length ? "success" :
    succeeded > 0               ? "partial"  : "failed";

  const results = {
    runAt,
    status:   overallStatus,
    summary:  `${succeeded}/${TARGETS.length} cities fully processed`,
    cities,
  };

  const dataDir = path.dirname(RESULTS_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2), "utf-8");

  console.log(`[agent] Done — ${results.summary}. Saved to data/results.json\n`);
  return results;
}

/**
 * Read the last saved results without running the agent.
 * @returns {Object|null}
 */
function readLastResults() {
  if (!fs.existsSync(RESULTS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

module.exports = { run, readLastResults, TARGETS };
