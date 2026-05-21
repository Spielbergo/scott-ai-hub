"use strict";
// Quick test of the new parser against the cached HTML dump
const { parseNumeric, labelToKey } = require("../lib/scraper");
const cheerio = require("cheerio");
const fs = require("fs");

const html = fs.readFileSync("./data/zolo_debug.html", "utf8");
const $ = cheerio.load(html);

const ZOLO_KEY_MAP = {
  avgSoldPrice: "avgSalePrice",
  newListingsLast28Days: "activeListings",
  homeSoldLast28Days: "soldListings",
  averageDaysOnMarket: "daysOnMarket",
  sellingToListingPriceRatio: "listToSaleRatio",
};

function cleanLabel(raw) {
  return raw.replace(/\s+\d+\s+/g, " ").replace(/\s+\d+$/, "").trim();
}

const raw = {};
const seen = new Set();
$(".card").each((_i, el) => {
  const val = $(el).find(".card-value").first().text().trim();
  const lbl = cleanLabel($(el).find(".card-title").first().text().trim());
  if (!lbl || !val) return;
  const key = labelToKey(lbl);
  if (seen.has(key)) return;
  seen.add(key);
  raw[key] = parseNumeric(val) ?? val;
});

const summaryText = $(".trends-summary").text();
const avgMatch = summaryText.match(/average house price of \$([\d,]+)/i);
if (avgMatch) raw.avgSalePrice = parseFloat(avgMatch[1].replace(/,/g, ""));
const domMatch = summaryText.match(/median days on market[^\d]*(\d+)/i);
if (domMatch) raw.daysOnMarket = parseInt(domMatch[1]);

const stats = {};
for (const [k, v] of Object.entries(raw)) {
  stats[ZOLO_KEY_MAP[k] || k] = v;
}

console.log("Parsed stats:", JSON.stringify(stats, null, 2));
