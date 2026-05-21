/**
 * lib/scraper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Web scraper for Zolo.ca real estate market trend pages.
 *
 * Zolo market-stats pages follow the pattern:
 *   https://www.zolo.ca/{city}-real-estate/trends
 *
 * The scraper extracts the main statistics table (median sale price,
 * price per sq ft, days on market, active listings, sold listings,
 * months of inventory) for each requested city.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const axios = require("axios");
const cheerio = require("cheerio");

// Rotate realistic browser user-agent strings to reduce bot-detection risk
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

const REQUEST_TIMEOUT_MS = 15000; // 15 s per page
const RETRY_DELAY_MS = 3000;      // 3 s between retries
const MAX_RETRIES = 3;

/**
 * Returns a random integer between min (inclusive) and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleeps for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch raw HTML for a URL with retry logic and rotating user-agents.
 * @param {string} url
 * @returns {Promise<string>} Raw HTML string
 */
async function fetchHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const userAgent = USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)];
      const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-CA,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
        // Follow up to 5 redirects
        maxRedirects: 5,
      });
      return response.data;
    } catch (err) {
      lastError = err;
      const isRetryable = !err.response || err.response.status >= 500 || err.code === "ECONNABORTED";
      if (isRetryable && attempt < MAX_RETRIES) {
        console.warn(`[scraper] Attempt ${attempt} failed for ${url}: ${err.message}. Retrying in ${RETRY_DELAY_MS}ms…`);
        await sleep(RETRY_DELAY_MS * attempt); // exponential back-off
      } else {
        break;
      }
    }
  }
  throw new Error(`[scraper] Failed to fetch ${url} after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

/**
 * Parse a numeric string that may contain $, %, commas, and whitespace.
 * Returns null if the value cannot be parsed.
 * @param {string} raw
 * @returns {number|null}
 */
function parseNumeric(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.replace(/[$,%\s]/g, "").replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Normalise a label string into a camelCase key.
 * e.g. "Median Sale Price" → "medianSalePrice"
 * @param {string} label
 * @returns {string}
 */
function labelToKey(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join("");
}

/**
 * Extract market statistics from a Zolo trends page.
 *
 * Zolo renders its stats in a grid of <div class="stats-card"> elements,
 * each containing a label and a value. This parser handles both the
 * stats-card layout and standard <table> rows as a fallback.
 *
 * @param {string} html  Raw HTML from Zolo trends page
 * @param {string} city  City slug (for logging)
 * @returns {Object} Map of stat keys to numeric values (or null)
 */
function parseZoloTrendsPage(html, city) {
  const $ = cheerio.load(html);
  const stats = {};

  // ── Strategy 1: stats-card grid (primary Zolo layout) ───────────────────
  $("[class*='stats-card'], [class*='stat-card'], [class*='market-stat']").each((_i, el) => {
    const labelEl = $(el).find("[class*='label'], [class*='title'], [class*='name'], h3, h4, p").first();
    const valueEl = $(el).find("[class*='value'], [class*='number'], [class*='figure'], strong, span").last();

    const label = labelEl.text().trim();
    const value = valueEl.text().trim();

    if (label && value) {
      const key = labelToKey(label);
      stats[key] = parseNumeric(value) ?? value;
    }
  });

  // ── Strategy 2: definition-list style (dl > dt + dd) ────────────────────
  if (Object.keys(stats).length === 0) {
    $("dl").each((_i, dl) => {
      const dts = $(dl).find("dt");
      const dds = $(dl).find("dd");
      dts.each((j, dt) => {
        const label = $(dt).text().trim();
        const value = $(dds[j]) ? $(dds[j]).text().trim() : null;
        if (label && value) {
          stats[labelToKey(label)] = parseNumeric(value) ?? value;
        }
      });
    });
  }

  // ── Strategy 3: generic <table> fallback ────────────────────────────────
  if (Object.keys(stats).length === 0) {
    $("table").each((_i, table) => {
      $(table).find("tr").each((_j, row) => {
        const cells = $(row).find("td, th");
        if (cells.length === 2) {
          const label = $(cells[0]).text().trim();
          const value = $(cells[1]).text().trim();
          if (label && value) {
            stats[labelToKey(label)] = parseNumeric(value) ?? value;
          }
        }
      });
    });
  }

  if (Object.keys(stats).length === 0) {
    console.warn(`[scraper] No stats found on Zolo trends page for "${city}". Zolo may have updated its layout.`);
  }

  return stats;
}

/**
 * Scrape market trend data for one city from Zolo.
 * @param {string} citySlug  e.g. "toronto", "vancouver"
 * @returns {Promise<{city: string, url: string, scrapedAt: string, stats: Object}>}
 */
async function scrapeCity(citySlug) {
  const url = `https://www.zolo.ca/${citySlug}-real-estate/trends`;
  console.log(`[scraper] Scraping: ${url}`);

  const html = await fetchHtml(url);
  const stats = parseZoloTrendsPage(html, citySlug);

  return {
    city: citySlug,
    url,
    scrapedAt: new Date().toISOString(),
    stats,
  };
}

/**
 * Scrape market trend data for multiple cities.
 * Adds a polite delay between requests to avoid rate-limiting.
 *
 * @param {string[]} citySlugs  Array of city slugs
 * @returns {Promise<Array<{city, url, scrapedAt, stats}>>}
 */
async function scrapeCities(citySlugs) {
  const results = [];
  for (const slug of citySlugs) {
    try {
      const result = await scrapeCity(slug);
      results.push(result);
    } catch (err) {
      console.error(`[scraper] Skipping "${slug}" due to error: ${err.message}`);
      results.push({ city: slug, url: null, scrapedAt: new Date().toISOString(), stats: {}, error: err.message });
    }
    // Polite delay between cities (2–5 s)
    if (citySlugs.indexOf(slug) < citySlugs.length - 1) {
      await sleep(randomInt(2000, 5000));
    }
  }
  return results;
}

module.exports = { scrapeCity, scrapeCities, parseNumeric, labelToKey };
