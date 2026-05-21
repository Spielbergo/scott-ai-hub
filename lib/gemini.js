/**
 * lib/gemini.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Gemini AI integration for generating WordPress content updates.
 *
 * Given Zolo market stats for a city, generates:
 *   - introParagraph  → Updated opening paragraph for the WP page
 *   - marketCondition → "Seller's Market" | "Buyer's Market" | "Balanced Market"
 *   - tableRow        → New month's row for the stats table
 *   - keyInsight      → One-sentence market highlight
 *   - lastUpdated     → "Month YYYY" string for date stamps
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL = "gemini-2.5-flash-lite";

/**
 * Format a number as CAD currency.
 * @param {number|null} n
 */
function formatCAD(n) {
  if (!n) return "N/A";
  return new Intl.NumberFormat("en-CA", {
    style: "currency", currency: "CAD", maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Build a human-readable stats summary for the Gemini prompt.
 * @param {Object} stats
 */
function statsSummary(stats) {
  const labels = {
    medianSalePrice:   "Median Sale Price",
    avgSalePrice:      "Average Sale Price",
    pricePerSqft:      "Price per sq ft",
    daysOnMarket:      "Days on Market",
    activeListings:    "Active Listings",
    soldListings:      "Sold Listings",
    monthsOfInventory: "Months of Inventory",
  };

  const lines = [];
  for (const [key, label] of Object.entries(labels)) {
    const val = stats[key];
    if (val === null || val === undefined) continue;
    const display = (key === "medianSalePrice" || key === "avgSalePrice" || key === "pricePerSqft")
      ? formatCAD(val)
      : typeof val === "number" ? val.toLocaleString("en-CA") : val;
    lines.push(`  ${label}: ${display}`);
  }

  // Include any extra keys the scraper found that aren't in our standard list
  const standardKeys = new Set(Object.keys(labels));
  for (const [key, val] of Object.entries(stats)) {
    if (!standardKeys.has(key) && val !== null && val !== undefined) {
      lines.push(`  ${key}: ${val}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "  (No stats available — use general market language)";
}

/**
 * Generate WordPress content updates for one city using Gemini.
 *
 * @param {string} cityName      e.g. "Orangeville"
 * @param {Object} stats         Sanitised stats from scraper
 * @param {string} zoloUrl       Source URL (for attribution)
 * @param {string} wpUrl         Target WordPress page URL (for context)
 * @returns {Promise<{
 *   introParagraph: string,
 *   marketCondition: string,
 *   tableRow: Object,
 *   keyInsight: string,
 *   lastUpdated: string
 * }>}
 */
async function generateMarketContent(cityName, stats, zoloUrl, wpUrl) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in environment variables.");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODEL });

  const now = new Date();
  const monthYear = now.toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  const prompt = `You are a professional real estate content writer for jenjewell.ca, a Canadian real estate brokerage website serving buyers and sellers in Orangeville, Caledon, and Shelburne, Ontario.

TASK: Generate updated content for the WordPress page: ${wpUrl}

City: ${cityName}, Ontario
Current Month/Year: ${monthYear}
Data sourced from: ${zoloUrl}

Market Statistics (from Zolo):
${statsSummary(stats)}

Generate a JSON object with EXACTLY these four keys:

1. "introParagraph"
   - 2 to 3 sentences only
   - Must naturally include "${monthYear}" and the city name
   - Reference median or average sale price if available
   - Written in a warm, professional tone suitable for home buyers and sellers
   - No markdown, no asterisks, no bullet points — plain prose only
   - Example style: "The Orangeville real estate market in May 2026 shows a median sale price of $750,000..."

2. "marketCondition"
   - MUST be exactly one of these three strings (no other values allowed):
     "Seller's Market" | "Buyer's Market" | "Balanced Market"
   - Rule: months of inventory < 2 → Seller's Market; > 4 → Buyer's Market; 2-4 → Balanced Market
   - If months of inventory unavailable, infer from active/sold ratio or days on market

3. "tableRow"
   - An object for the statistics table row representing ${monthYear}
   - Fields: month (string "${monthYear}"), medianSalePrice (number or null), avgSalePrice (number or null), soldListings (number or null), activeListings (number or null), daysOnMarket (number or null), monthsOfInventory (number or null)
   - Use the most accurate values from the stats above; null if genuinely unavailable

4. "keyInsight"
   - Exactly one sentence
   - The single most important market observation from the data
   - Must be specific and factual, not generic

Return ONLY a valid JSON object. No markdown code fences, no explanation text before or after.`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text().trim();

  // Strip any markdown code fences Gemini might wrap the JSON in
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: extract first JSON object from response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Gemini response was not valid JSON:\n${cleaned.slice(0, 300)}`);
    parsed = JSON.parse(match[0]);
  }

  // Ensure required keys exist
  parsed.lastUpdated = monthYear;
  parsed.introParagraph = parsed.introParagraph || "";
  parsed.marketCondition = parsed.marketCondition || "Balanced Market";
  parsed.tableRow = parsed.tableRow || { month: monthYear };
  parsed.keyInsight = parsed.keyInsight || "";

  return parsed;
}

module.exports = { generateMarketContent };
