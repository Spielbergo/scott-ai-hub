"use strict";

const cheerio = require("cheerio");
const fs = require("fs");
const html = fs.readFileSync("./data/zolo_debug.html", "utf8");
const $ = cheerio.load(html);

console.log("=== Looking for keyword-containing elements ===\n");
const keywords = ["median", "average", "days on market", "price per", "active listing", "sold", "inventory", "months"];
const found = [];

$("*").each((i, el) => {
  const text = $(el).clone().children().remove().end().text().trim().toLowerCase();
  if (keywords.some((k) => text.includes(k)) && text.length < 80 && text.length > 3) {
    const tag = el.tagName;
    const cls = ($(el).attr("class") || "").slice(0, 80);
    found.push({ tag, cls, text: text.slice(0, 70) });
  }
});

const seen = new Set();
found
  .filter((f) => { if (seen.has(f.text)) return false; seen.add(f.text); return true; })
  .slice(0, 50)
  .forEach((f) => console.log(`<${f.tag}> [${f.cls}] -> "${f.text}"`));

console.log("\n=== Checking for specific class patterns ===\n");
["market-stat", "stats-card", "stat-card", "statistic", "trend", "stat_", "_stat", "kpi", "metric"].forEach((pat) => {
  const els = $(`[class*='${pat}']`);
  if (els.length > 0) {
    console.log(`class*="${pat}" -> ${els.length} elements`);
    els.slice(0, 3).each((i, el) => {
      console.log("  ", $(el).text().trim().replace(/\s+/g, " ").slice(0, 100));
    });
  }
});

console.log("\n=== DL elements ===\n");
$("dl").slice(0, 5).each((i, dl) => {
  const dts = $(dl).find("dt").map((j, dt) => $(dt).text().trim()).get();
  const dds = $(dl).find("dd").map((j, dd) => $(dd).text().trim()).get();
  console.log(`dl[${i}]:`, dts.slice(0, 5), dds.slice(0, 5));
});

console.log("\n=== Sections / headings ===\n");
$("h1,h2,h3").each((i, el) => {
  console.log(`<${el.tagName}> "${$(el).text().trim().slice(0, 80)}"`);
});
