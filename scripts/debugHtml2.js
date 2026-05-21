"use strict";

const cheerio = require("cheerio");
const fs = require("fs");
const html = fs.readFileSync("./data/zolo_debug.html", "utf8");
const $ = cheerio.load(html);

console.log("=== card-title elements with parent context ===\n");
$(".card-title").each((i, el) => {
  const label = $(el).text().trim();
  const card = $(el).closest("[class*='card'],[class*='stat'],[class*='kpi']");
  const cardHtml = card.length ? card.text().trim().replace(/\s+/g, " ").slice(0, 200) : "NO CARD PARENT";
  console.log(`[${i}] label="${label}"`);
  console.log(`    parent text="${cardHtml}"\n`);
});

console.log("\n=== trend-* element text ===\n");
$("[class*='trend']").slice(0, 5).each((i, el) => {
  const cls = $(el).attr("class");
  const text = $(el).text().trim().replace(/\s+/g, " ").slice(0, 300);
  console.log(`[${i}] class="${cls}"\n  text="${text}"\n`);
});

console.log("\n=== Full h5.card-title sibling structure (first 3) ===\n");
$("h5.card-title, h5[class*='card-title']").slice(0, 6).each((i, el) => {
  const parent = $(el).parent();
  const parentCls = parent.attr("class") || "";
  const siblings = parent.children().map((j, c) => `<${c.tagName} class="${$(c).attr('class')||''}">${$(c).text().trim().slice(0,40)}`).get();
  console.log(`[${i}] parent class="${parentCls.slice(0,80)}"`);
  siblings.forEach(s => console.log("  ", s));
  console.log();
});
