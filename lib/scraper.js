/**
 * lib/scraper.js
 * Uses Playwright (headless Chromium) to bypass Zolo.ca Cloudflare protection.
 * A single browser context is reused across all target cities per run.
 */

"use strict";

const cheerio = require("cheerio");
const { chromium } = require("playwright");

const PAGE_TIMEOUT_MS  = 30000;
const BETWEEN_PAGES_MS = [3000, 6000];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -- HTML parser helpers -------------------------------------------------------

function parseNumeric(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.replace(/[$%,\s]/g, "").trim();
  // Handle M / K suffix (e.g. "$1.1M" → 1100000, "$785K" → 785000)
  const mMatch = cleaned.match(/^([\d.]+)[Mm]$/);
  if (mMatch) return parseFloat(mMatch[1]) * 1_000_000;
  const kMatch = cleaned.match(/^([\d.]+)[Kk]$/);
  if (kMatch) return parseFloat(kMatch[1]) * 1_000;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function labelToKey(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join("");
}

// Map Zolo card-title text (after labelToKey) → sanitizer expected keys
const ZOLO_KEY_MAP = {
  avgSoldPrice:                   "avgSalePrice",
  newListingsLast28Days:          "activeListings",
  homesSoldLast28Days:            "soldListings",
  averageDaysOnMarket:            "daysOnMarket",
  sellingToListingPriceRatio:     "listToSaleRatio",
  monthlyChange:                  "monthlyChange",
  quarterlyChange:                "quarterlyChange",
  yearlyChange:                   "yearlyChange",
  monthlyChangeClass:             "monthlyChangeClass",
  quarterlyChangeClass:           "quarterlyChangeClass",
  yearlyChangeClass:              "yearlyChangeClass",
};

/**
 * Strip standalone SINGLE-digit footnote markers from label text.
 * e.g. "homes sold 1 (last 28 days)" → "homes sold (last 28 days)"
 * Does NOT strip multi-digit numbers like "28" in "last 28 days".
 */
function cleanLabel(raw) {
  return raw
    .replace(/\s+[1-9]\s+/g, " ") // lone single digit surrounded by spaces
    .replace(/\s+[1-9]$/, "")      // lone single digit at end
    .trim();
}

// ── Per-bedroom table parsers ─────────────────────────────────────────────────

/**
 * Parse Zolo's per-bedroom PRICE tables.
 * Returns { dateRange, detached, townhouse, condo }
 * Each array: [{ beds, price, pct, pctClass, mo3, mo6, yr1, isAll }]
 */
function parsePriceTables($) {
  const result = { dateRange: null, detached: [], townhouse: [], condo: [] };

  const headerDate = $("#detached-price-table thead th").eq(1).text().trim();
  if (headerDate) result.dateRange = headerDate;

  const MAP = [
    ["#detached-price-table",  "detached"],
    ["#townhouse-price-table", "townhouse"],
    ["#condo-price-table",     "condo"],
  ];

  for (const [sel, key] of MAP) {
    $(sel + " tbody tr").each((_, tr) => {
      const $tds = $(tr).find("td");
      const beds = $tds.eq(0).text().trim();
      if (!beds) return;

      // Current-period cell (index 1)
      const $c = $tds.eq(1);
      let price = null, pct = null, pctClass = null;
      if ($c.find(".text-muted").length === 0) {
        const $sm = $c.find("small");
        if ($sm.length) {
          pct      = $sm.text().trim();
          pctClass = $sm.hasClass("text-green") ? "increase-p"
                   : $sm.hasClass("text-red")   ? "decrease-p"
                   :                               "mr-dark-grey";
        }
        price = $c.clone().find("small").remove().end().text().trim() || null;
      }

      // Historical cells (3mo, 6mo, 1yr)
      const hist = (i) => {
        const $td = $tds.eq(i);
        if (!$td.length || $td.find(".text-muted").length > 0) return null;
        return $td.clone().find("small").remove().end().text().trim() || null;
      };

      result[key].push({
        beds,
        price,
        pct,
        pctClass,
        mo3:   hist(2),
        mo6:   hist(3),
        yr1:   hist(4),
        isAll: beds.toLowerCase() === "all",
      });
    });
  }

  return result;
}

/**
 * Parse Zolo's per-bedroom INVENTORY tables.
 * Returns { detached, townhouse, condo }
 * Each array: [{ beds, newListings, soldListings, activeListings, dom, saleToList, isAll }]
 * Each stat is { val, pct, cls } (val/pct can be null for n/a).
 */
function parseInventoryTables($) {
  const result = { detached: [], townhouse: [], condo: [] };

  const MAP = [
    ["#detached-inventory-table",  "detached"],
    ["#townhouse-inventory-table", "townhouse"],
    ["#condo-inventory-table",     "condo"],
  ];

  const parseCell = ($td) => {
    if (!$td.length || $td.find(".text-muted").length > 0) {
      return { val: null, pct: null, cls: null };
    }
    const $sm = $td.find("small");
    let pct = null, cls = null;
    if ($sm.length) {
      pct = $sm.text().trim();
      cls = $sm.hasClass("text-green") ? "increase-p"
          : $sm.hasClass("text-red")   ? "decrease-p"
          :                               "mr-dark-grey";
    }
    const val = $td.clone().find("small").remove().end().text().trim() || null;
    return { val, pct, cls };
  };

  for (const [sel, key] of MAP) {
    $(sel + " tbody tr").each((_, tr) => {
      const $tds = $(tr).find("td");
      const beds = $tds.eq(0).text().trim();
      if (!beds) return;

      result[key].push({
        beds,
        newListings:    parseCell($tds.eq(1)),
        soldListings:   parseCell($tds.eq(2)),
        activeListings: parseCell($tds.eq(3)),
        dom:            parseCell($tds.eq(4)),
        saleToList:     parseCell($tds.eq(5)),
        isAll:          beds.toLowerCase() === "all",
      });
    });
  }

  return result;
}

// ── Primary stats parser ──────────────────────────────────────────────────────

function parseZoloPage(html, label) {
  const $ = cheerio.load(html);
  const raw = {};

  // ── Primary: Zolo .card > .card-value + .card-title structure ───────────────
  // Only pick the FIRST card for each label (skip duplicates from past-period column)
  const seenLabels = new Set();
  $(".card").each((_i, el) => {
    const $val = $(el).find(".card-value").first();
    const valText = $val.text().trim();
    const lblText = cleanLabel($(el).find(".card-title").first().text().trim());
    if (!lblText || !valText) return;
    const key = labelToKey(lblText);
    if (seenLabels.has(key)) return; // skip duplicate (past-period column)
    seenLabels.add(key);
    raw[key] = parseNumeric(valText) ?? valText;
    // Capture increase/decrease class from Zolo SVG arrow inside the card
    // The class is on the <svg> element: class="fill-current text-red" or text-green
    if ($val.find(".text-green").length > 0) raw[key + "Class"] = "increase";
    else if ($val.find(".text-red").length > 0) raw[key + "Class"] = "decrease";
  });

  // ── Supplement: extract exact dollar value from the summary paragraph ───────
  const summaryText = $(".trends-summary").text();
  // Always prefer the exact number from the summary paragraph over the rounded card value
  const avgMatch = summaryText.match(/average house price of \$([\d,]+)/i);
  if (avgMatch) {
    raw.avgSalePrice = parseFloat(avgMatch[1].replace(/,/g, ""));
  }
  const medianDomMatch = summaryText.match(/median days on market[^\d]*(\d+)/i);
  if (medianDomMatch && !raw.daysOnMarket) {
    raw.daysOnMarket = parseInt(medianDomMatch[1]);
  }

  // ── Extract current date range from the trends-stats bar ────────────────────
  // e.g. "Current (Apr 20 - May 18) Past (Mar 23 - Apr 20) ..."
  const trendsStatsText = $(".trends-stats").first().text();
  const dateRangeMatch = trendsStatsText.match(/Current\s*\(([^)]+)\)/i);
  if (dateRangeMatch) {
    raw.dateRange = dateRangeMatch[1].trim();
  }

  // ── Normalize keys to sanitizer-expected names ───────────────────────────────
  const stats = {};
  for (const [key, val] of Object.entries(raw)) {
    const mappedKey = ZOLO_KEY_MAP[key] || key;
    stats[mappedKey] = val;
  }

  if (Object.keys(stats).length === 0) {
    console.warn(`[scraper] No stats parsed for "${label}". Zolo layout may have changed.`);
  } else {
    const keyList = Object.keys(stats).join(", ");
    console.log(`[scraper] "${label}" -> ${Object.keys(stats).length} stats: ${keyList}`);
  }

  // ── Parse per-bedroom table data ──────────────────────────────────────────
  const priceTables     = parsePriceTables($);
  const inventoryTables = parseInventoryTables($);

  if (priceTables.detached.length > 0) {
    console.log(`[scraper] "${label}" -> price table rows: detached=${priceTables.detached.length}, townhouse=${priceTables.townhouse.length}, condo=${priceTables.condo.length}`);
  }
  if (inventoryTables.detached.length > 0) {
    console.log(`[scraper] "${label}" -> inventory table rows: detached=${inventoryTables.detached.length}, townhouse=${inventoryTables.townhouse.length}, condo=${inventoryTables.condo.length}`);
  }

  return { stats, priceTables, inventoryTables };
}

// -- Playwright ----------------------------------------------------------------

async function fetchWithPlaywright(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: PAGE_TIMEOUT_MS });
    await page.waitForTimeout(2000);
    return await page.content();
  } finally {
    await page.close();
  }
}

async function scrapeUrl(context, url, label) {
  console.log(`[scraper] Navigating to: ${url}`);
  const html = await fetchWithPlaywright(context, url);
  const { stats, priceTables, inventoryTables } = parseZoloPage(html, label);
  return {
    label,
    url,
    scrapedAt: new Date().toISOString(),
    stats,
    priceTables,
    inventoryTables,
    rawStatCount: Object.keys(stats).length,
  };
}

async function scrapeTargets(targets) {
  console.log("[scraper] Launching headless Chromium...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "en-CA",
    timezoneId: "America/Toronto",
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "Accept-Language": "en-CA,en;q=0.9" },
  });

  // Warm up: visit homepage first so session looks natural
  try {
    console.log("[scraper] Warming up session on zolo.ca...");
    const warmPage = await context.newPage();
    await warmPage.goto("https://www.zolo.ca/", {
      waitUntil: "networkidle",
      timeout: PAGE_TIMEOUT_MS,
    });
    await warmPage.waitForTimeout(randomInt(1500, 3000));
    await warmPage.close();
    console.log("[scraper] Session warmed up.");
  } catch (err) {
    console.warn(`[scraper] Warm-up failed (non-fatal): ${err.message}`);
  }

  const results = [];
  try {
    for (let i = 0; i < targets.length; i++) {
      const { url, label } = targets[i];
      try {
        results.push(await scrapeUrl(context, url, label));
      } catch (err) {
        console.error(`[scraper] Skipping "${label}": ${err.message}`);
        results.push({
          label,
          url,
          scrapedAt: new Date().toISOString(),
          stats: {},
          error: err.message,
        });
      }
      if (i < targets.length - 1) {
        const delay = randomInt(...BETWEEN_PAGES_MS);
        console.log(`[scraper] Waiting ${delay}ms before next city...`);
        await sleep(delay);
      }
    }
  } finally {
    await browser.close();
    console.log("[scraper] Browser closed.");
  }

  return results;
}

module.exports = { scrapeUrl, scrapeTargets, parseNumeric, labelToKey };
