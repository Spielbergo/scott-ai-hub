/**
 * lib/wordpress.js
 * ─────────────────────────────────────────────────────────────────────────────
 * WordPress REST API integration for the jenjewell.ca market trends pages.
 * Uses Application Passwords (Classic Editor, no Gutenberg).
 *
 * Updates the following sections without touching the tab tables:
 *   • H2 month/year ("Housing Market Report for May 2026")
 *   • Intro paragraph (avg price, new listings, days on market)
 *   • Housing Stats section  (avg sold price, change cards)
 *   • Housing Inventory section
 *   • Rankings section
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const axios = require("axios");

// ── Config ────────────────────────────────────────────────────────────────────

function getConfig() {
  const site = process.env.WP_SITE_URL;
  const user = process.env.WP_USERNAME;
  const pass = process.env.WP_APP_PASSWORD;
  if (!site || !user || !pass) {
    throw new Error(
      "WordPress credentials not configured. " +
        "Add WP_SITE_URL, WP_USERNAME, and WP_APP_PASSWORD to .env.local"
    );
  }
  return {
    baseUrl: site.replace(/\/$/, ""),
    auth: Buffer.from(`${user}:${pass}`).toString("base64"),
  };
}

// ── REST API helpers ──────────────────────────────────────────────────────────

async function fetchPageContent(pageId) {
  const { baseUrl, auth } = getConfig();
  const res = await axios.get(
    `${baseUrl}/wp-json/wp/v2/pages/${pageId}?context=edit`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return res.data.content.raw;
}

async function updatePageContent(pageId, content, meta = null) {
  const { baseUrl, auth } = getConfig();
  const body = { content };
  if (meta) body.meta = meta;
  const res = await axios.put(
    `${baseUrl}/wp-json/wp/v2/pages/${pageId}`,
    body,
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
    }
  );
  return res.data;
}

// ── Number / text formatting ──────────────────────────────────────────────────

/**
 * Format a dollar amount as a display shorthand.
 * 1179503 → "$1.2M"  |  729342 → "$729K"
 */
function formatPriceShort(num) {
  if (!num) return "n/a";
  if (num >= 1_000_000) return "$" + (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  return "$" + Math.round(num / 1000) + "K";
}

/**
 * Format a dollar amount with commas.
 * 1179503 → "$1,179,503"
 */
function formatPriceFull(num) {
  if (!num) return "n/a";
  return "$" + Math.round(num).toLocaleString("en-CA");
}

/**
 * Percentage always displayed positive; direction via CSS class.
 * -28.7 → "28.7%"
 */
function formatPct(num) {
  return Math.abs(num).toFixed(1).replace(/\.0$/, "") + "%";
}

/** "increase" or "decrease" CSS class based on sign. */
function changeClass(num) {
  return num >= 0 ? "increase" : "decrease";
}

/** 8 → "8th", 1 → "1st", etc. */
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "May 2026" from current date */
function currentMonthYear() {
  return new Date().toLocaleString("en-CA", { month: "long", year: "numeric" });
}

// ── HTML section builders ─────────────────────────────────────────────────────

/**
 * Replace the H2 month heading and intro paragraph in the titles section.
 * Only the average price and days-on-market numbers are updated;
 * everything else in the paragraph is left as-is.
 */
function applyIntroUpdates(html, city, stats) {
  const monthYear = currentMonthYear();
  const avgFull   = formatPriceFull(stats.avgSalePrice);
  const dom       = stats.daysOnMarket ?? 0;

  // H2: "Housing Market Report for May 2026"
  let updated = html.replace(
    /(<h2>Housing Market Report for )[^<]+(<\/h2>)/,
    `$1${monthYear}$2`
  );

  // Update only the avg price within the Answer paragraph.
  // Handles the clean format:  "is $1,179,503 and/with"  (Caledon: "and", Shelburne/Orangeville: "with")
  // AND the previously-broken: "is  is ,204,892 and"     (duplicate "is", missing "$")
  updated = updated.replace(
    / is (?:\s*is\s*)?\$?,?[\d,.]+[KM]? (and|with) /,
    (_m, conj) => ` is ${avgFull} ${conj} `
  );

  // Update new listings count
  // e.g. "293 new listings appearing"
  updated = updated.replace(
    /(\d+)( new listings appearing)/,
    () => `${stats.activeListings ?? 0} new listings appearing`
  );

  // Update only the days on market
  // e.g. "market is 27 days according"
  updated = updated.replace(
    /(market is )(\d+)( days according)/i,
    (_m, a, _b, c) => `${a}${dom}${c}`
  );

  return updated;
}

// ── Section tag detection + nesting-aware replacer ───────────────────────────

/**
 * Detect whether this page uses <section> or <div> for market-trends sections.
 * Orangeville uses <div class="market-trends--section">; Caledon/Shelburne use <section>.
 */
function detectSectionTag(html) {
  return html.includes('<section class="market-trends--section"') ? 'section' : 'div';
}

/**
 * Find the market-trends section that contains `anchor` and replace it with `newContent`.
 * Handles both <section> and <div> wrappers via nesting-depth counting, so inner
 * </div> tags don't confuse the search for the section's actual closing tag.
 *
 * @param {string} html        - Full page HTML
 * @param {string} anchor      - Unique string inside the target section
 * @param {string} newContent  - Replacement HTML for the whole section
 * @returns {string}
 */
function findAndReplaceSection(html, anchor, newContent) {
  const anchorIdx = html.indexOf(anchor);
  if (anchorIdx === -1) return html;

  // Walk backward to find the nearest section/div.market-trends--section opener
  const before   = html.substring(0, anchorIdx);
  const divStart = before.lastIndexOf('<div class="market-trends--section"');
  const secStart = before.lastIndexOf('<section class="market-trends--section"');
  const sectionStart = Math.max(divStart, secStart);
  if (sectionStart === -1) return html;

  const tag      = divStart > secStart ? 'div' : 'section';
  const openTag  = `<${tag}`;
  const closeTag = `</${tag}>`;

  // Skip past the opening tag (to its ">")
  const tagEnd = html.indexOf('>', sectionStart) + 1;

  // Walk forward counting nesting depth to find the matching close tag
  let depth = 1;
  let pos   = tagEnd;
  while (pos < html.length && depth > 0) {
    const nextOpen  = html.indexOf(openTag,  pos);
    const nextClose = html.indexOf(closeTag, pos);
    if (nextClose === -1) return html; // malformed
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 1;
    } else {
      depth--;
      pos = nextClose + closeTag.length;
    }
  }

  return html.substring(0, sectionStart) + newContent + html.substring(pos);
}

/**
 * Build the Housing Stats section HTML.
 * Replaces: date label + the four stat cards (avg price, monthly, quarterly, yearly change).
 */
function buildStatsSection(city, stats, dateRange, tag = 'section') {
  const avg       = formatPriceShort(stats.avgSalePrice);
  const monthly   = stats.monthlyChange   ?? 0;
  const quarterly = stats.quarterlyChange ?? 0;
  const yearly    = stats.yearlyChange    ?? 0;

  // Use Zolo's own colour class if captured, otherwise fall back to sign-based
  const monthlyCls   = stats.monthlyChangeClass   || changeClass(monthly);
  const quarterlyCls = stats.quarterlyChangeClass || changeClass(quarterly);
  const yearlyCls    = stats.yearlyChangeClass    || changeClass(yearly);

  return `<${tag} class="market-trends--section">
    <h2 class="market-trends--section-title jj-mb-0">${city} Housing Stats</h2>
    <p class="market-trends--section-dates jj-mb-25">${dateRange || ""}</p>

    <div class="market-trends--data-container">
        <!-- Item 1 -->
        <div>
            <p class="market-trends--data">${avg}</p>
            <h4 class="market-trends--data-small">Avg Sold Price</h4>
        </div>
        <!-- Item 3 -->
        <div>
            <p class="market-trends--data ${monthlyCls}">${formatPct(monthly)}</p>
            <h4 class="market-trends--data-small">Monthly Change</h4>
        </div>
        <!-- Item 4 -->
        <div>
            <p class="market-trends--data ${quarterlyCls}">${formatPct(quarterly)}</p>
            <h4 class="market-trends--data-small">Quarterly Change</h4>
        </div>
        <!-- Item 5 -->
        <div>
            <p class="market-trends--data ${yearlyCls}">${formatPct(yearly)}</p>
            <h4 class="market-trends--data-small">Yearly Change</h4>
        </div>
    </div>
</${tag}>`;
}

/**
 * Build the Housing Inventory section HTML.
 */
function buildInventorySection(city, stats, tag = 'section') {
  const ratio = stats.listToSaleRatio ?? 0;
  return `<${tag} class="market-trends--section">
    <h2 class="market-trends--section-title">${city} Housing Inventory</h2>

    <div class="market-trends--data-container">
        <!-- Item 1 -->
        <div>
            <p class="market-trends--data">${stats.activeListings ?? 0}</p>
            <h4 class="market-trends--data-small">new listings</h4>
            <p class="market-trends--data-small-sub">(last 28 days)</p>
        </div>
        <!-- Item 2 -->
        <div>
            <p class="market-trends--data">${stats.soldListings ?? 0}</p>
            <h4 class="market-trends--data-small">homes sold</h4>
            <p class="market-trends--data-small-sub">(last 28 days)</p>
        </div>
        <!-- Item 3 -->
        <div>
            <p class="market-trends--data">${stats.daysOnMarket ?? 0}</p>
            <h4 class="market-trends--data-small">average days on market</h4>
        </div>
        <!-- Item 4 -->
        <div>
            <p class="market-trends--data">${ratio}%</p>
            <h4 class="market-trends--data-small">selling to listing ratio</h4>
        </div>
    </div>
</${tag}>`;
}

/**
 * Build the Rankings section HTML.
 */
function buildRankingsSection(city, stats, tag = 'section') {
  return `<${tag} class="market-trends--section" style="padding-bottom: 75px;">
    <h2 class="market-trends--section-title">${city} Rankings <span>out of 23 in Greater Toronto</span></h2>

    <div class="market-trends--data-container">
        <!-- Item 1 -->
        <div>
            <p class="market-trends--data">${ordinal(stats.mostExpensive ?? 0)}</p>
            <h4 class="market-trends--data-small">Most expensive</h4>
        </div>
        <!-- Item 2 -->
        <div>
            <p class="market-trends--data">${ordinal(stats.fastestGrowing ?? 0)}</p>
            <h4 class="market-trends--data-small">Fastest Growing</h4>
        </div>
        <!-- Item 3 -->
        <div>
            <p class="market-trends--data">${ordinal(stats.fastestSelling ?? 0)}</p>
            <h4 class="market-trends--data-small">Fastest Selling</h4>
        </div>
        <!-- Item 4 -->
        <div>
            <p class="market-trends--data">${ordinal(stats.highestTurnover ?? 0)}</p>
            <h4 class="market-trends--data-small">Highest Turnover</h4>
        </div>
    </div>
</${tag}>`;
}

// ── Tab-table section builders ────────────────────────────────────────────────

/**
 * Zolo class → WordPress span class.
 * text-green → increase-p, text-red → decrease-p, anything else → mr-dark-grey
 */
function zoloToWpClass(cls) {
  if (cls === "increase-p") return "increase-p";
  if (cls === "decrease-p") return "decrease-p";
  return "mr-dark-grey";
}

/** Build one <tr> for the price-by-bedroom table. */
function buildPriceTableRow(row) {
  const trClass = row.isAll ? ' class="last-table-item"' : "";

  let currentCell;
  if (!row.price) {
    currentCell = `<td class="grey">n/a <span></span></td>`;
  } else if (row.pct) {
    currentCell = `<td>${row.price} <span class="${zoloToWpClass(row.pctClass)}">${row.pct}</span></td>`;
  } else {
    currentCell = `<td>${row.price} <span class="decrease-p"></span></td>`;
  }

  const histCell = (val) =>
    val
      ? `<td>${val} <span class="decrease-p"></span></td>`
      : `<td class="grey">n/a <span></span></td>`;

  return `                <tr${trClass}>
                    <td>${row.beds}</td>
                    ${currentCell}
                    ${histCell(row.mo3)}
                    ${histCell(row.mo6)}
                    ${histCell(row.yr1)}
                </tr>`;
}

/** Build one <tr> for the inventory-by-bedroom table. */
function buildInventoryTableRow(row) {
  const trClass = row.isAll ? ' class="last-table-item"' : "";

  const numCell = (col) => {
    if (!col || col.val === null) return `<td class="grey">n/a <span></span></td>`;
    if (col.pct) return `<td>${col.val} <span class="${zoloToWpClass(col.cls)}">${col.pct}</span></td>`;
    return `<td>${col.val} <span class="decrease-p"></span></td>`;
  };

  const slCell = (col) => {
    if (!col || col.val === null || col.val === "0%") {
      return `<td class="mr-dark-grey mob-display-none">0%<span></span></td>`;
    }
    if (col.pct) {
      return `<td class="mob-display-none">${col.val} <span class="${zoloToWpClass(col.cls)}">${col.pct}</span></td>`;
    }
    return `<td class="mob-display-none">${col.val}<span></span></td>`;
  };

  return `                <tr${trClass}>
                    <td>${row.beds}</td>
                    ${numCell(row.newListings)}
                    ${numCell(row.soldListings)}
                    ${numCell(row.activeListings)}
                    ${numCell(row.dom)}
                    ${slCell(row.saleToList)}
                </tr>`;
}

/** Generate the city-specific realtor page URL from the city name. */
function realtorUrl(city) {
  const slug = city.toLowerCase();
  // Shelburne uses a different slug pattern
  if (slug === 'shelburne') {
    return `https://www.jenjewell.ca/ontario/${slug}/${slug}-real-estate-agents/`;
  }
  return `https://www.jenjewell.ca/ontario/${slug}/${slug}-realtors/`;
}

/**
 * Build the first tab section (price-by-bedroom tables).
 */
function buildPriceTablesSection(city, priceTables, tag = 'section') {
  const dr = priceTables.dateRange || "";

  const buildTab = (rows, tabId) => {
    const rowsHtml = rows.map((r) => buildPriceTableRow(r)).join("\n");
    return `    <div id="${tabId}" class="tabcontent">
        <table class="market-trends-table">
            <thead>
                <tr>
                    <th># Beds</th>
                    <th>${dr}</th>
                    <th>3 mo ago</th>
                    <th>6 mo ago</th>
                    <th>1 year ago</th>
                </tr>
            </thead>
            <tbody>
${rowsHtml}
            </tbody>
        </table>
    </div>`;
  };

  return `<${tag} class="market-trends--section">
    <!-- First set of Tab links -->
    <div class="tab" id="firstTabGroup">
        <button class="tablinks" onclick="switchTabGroup1(event, 'Detached-1')">Detached</button>
        <button class="tablinks" onclick="switchTabGroup1(event, 'Townhouse-1')">Townhouse</button>
        <button class="tablinks" onclick="switchTabGroup1(event, 'Condo-1')">Condo</button>
        <a href="${realtorUrl(city)}">Realtors in ${city}, Ontario</a>
    </div>

    <!-- First set of Tab content -->
${buildTab(priceTables.detached, "Detached-1")}

${buildTab(priceTables.townhouse, "Townhouse-1")}

${buildTab(priceTables.condo, "Condo-1")}
</${tag}>`;
}

/**
 * Build the second tab section (inventory-by-bedroom tables).
 */
function buildInventoryTablesSection(city, inventoryTables, tag = 'section') {
  const buildTab = (rows, tabId) => {
    const rowsHtml = rows.map((r) => buildInventoryTableRow(r)).join("\n");
    return `    <div id="${tabId}" class="tabcontent">
        <table class="market-trends-table">
            <thead>
                <tr>
                    <th># Beds</th>
                    <th>New Listings</th>
                    <th>Sold Listings</th>
                    <th>Active Listings</th>
                    <th>Days on Market</th>
                    <th class="mob-display-none">Sale to List</th>
                </tr>
            </thead>
            <tbody>
${rowsHtml}
            </tbody>
        </table>
    </div>`;
  };

  return `<${tag} class="market-trends--section">
    <!-- Second set of Tab links -->
    <div class="tab" id="secondTabGroup">
        <button class="tablinks" onclick="switchTabGroup2(event, 'Detached-2')">Detached</button>
        <button class="tablinks" onclick="switchTabGroup2(event, 'Townhouse-2')">Townhouse</button>
        <button class="tablinks" onclick="switchTabGroup2(event, 'Condo-2')">Condo</button>
    </div>

    <!-- Second set of Tab content -->
${buildTab(inventoryTables.detached, "Detached-2")}

${buildTab(inventoryTables.townhouse, "Townhouse-2")}

${buildTab(inventoryTables.condo, "Condo-2")}
</${tag}>`;
}

/**
 * Replace the price tab-table section in the WordPress page HTML.
 * Identified by: <!-- First set of Tab links --> inside the section.
 */
function replacePriceTablesSection(html, city, priceTables) {
  if (!priceTables || !priceTables.detached || priceTables.detached.length === 0) return html;
  const tag = detectSectionTag(html);
  const newSection = buildPriceTablesSection(city, priceTables, tag);
  return findAndReplaceSection(html, '<!-- First set of Tab links -->', newSection);
}

/**
 * Replace the inventory tab-table section in the WordPress page HTML.
 * Identified by: <!-- Second set of Tab links --> inside the section.
 */
function replaceInventoryTablesSection(html, city, inventoryTables) {
  if (!inventoryTables || !inventoryTables.detached || inventoryTables.detached.length === 0) return html;
  const tag = detectSectionTag(html);
  const newSection = buildInventoryTablesSection(city, inventoryTables, tag);
  return findAndReplaceSection(html, '<!-- Second set of Tab links -->', newSection);
}

// ── Regex-based section replacement ──────────────────────────────────────────

/**
 * Replace the Housing Stats section in the page HTML.
 * Identified by: heading with jj-mb-0 class (only on the stats section).
 */
function replaceStatsSection(html, city, stats, dateRange) {
  const tag = detectSectionTag(html);
  const newSection = buildStatsSection(city, stats, dateRange, tag);
  return findAndReplaceSection(html, 'class="market-trends--section-title jj-mb-0"', newSection);
}

/**
 * Replace the Housing Inventory section.
 * Identified by: "Housing Inventory" in its h2.
 */
function replaceInventorySection(html, city, stats) {
  const tag = detectSectionTag(html);
  const newSection = buildInventorySection(city, stats, tag);
  return findAndReplaceSection(html, 'Housing Inventory', newSection);
}

/**
 * Replace the Rankings section.
 * Identified by: style="padding-bottom: 75px;" on the section opener.
 */
function replaceRankingsSection(html, city, stats) {
  const tag = detectSectionTag(html);
  const newSection = buildRankingsSection(city, stats, tag);
  return findAndReplaceSection(html, 'padding-bottom: 75px', newSection);
}

// ── Yoast SEO meta builder ───────────────────────────────────────────────────

/**
 * Build Yoast SEO title and description from current stats.
 * Template matches the pattern in titles-and-descriptions.html.
 */
function buildYoastMeta(city, stats) {
  const monthYear = currentMonthYear();
  const avgFull   = formatPriceFull(stats.avgSalePrice);
  return {
    _yoast_wpseo_title:    `What is the Average House Price in ${city}? - ${monthYear}`,
    _yoast_wpseo_metadesc: `Answer: The latest MLS\u00ae statistics show that the average price of a house in ${city} is ${avgFull} as of ${monthYear}.`,
  };
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Fetch a WordPress page, replace all dynamic market data sections, push back.
 *
 * @param {number|string} pageId          WordPress page ID
 * @param {string}        city            City name (e.g. "Caledon")
 * @param {Object}        stats           Cleaned stats from the scraper/sanitizer
 * @param {string}        dateRange       Date range string from Zolo (e.g. "Apr 20 - May 18")
 * @param {Object|null}   priceTables     Per-bedroom price table data (or null to skip)
 * @param {Object|null}   inventoryTables Per-bedroom inventory table data (or null to skip)
 * @returns {Promise<{updated: boolean, pageId, city}>}
 */
async function updateWordPressPage(pageId, city, stats, dateRange, priceTables, inventoryTables) {
  console.log(`[wordpress] Fetching page ${pageId} for "${city}"…`);
  let content = await fetchPageContent(pageId);

  content = applyIntroUpdates(content, city, stats);
  content = replaceStatsSection(content, city, stats, dateRange);
  content = replaceInventorySection(content, city, stats);
  content = replaceRankingsSection(content, city, stats);
  content = replacePriceTablesSection(content, city, priceTables);
  content = replaceInventoryTablesSection(content, city, inventoryTables);

  // Update Yoast SEO title + description for Caledon and Shelburne.
  // Orangeville's Yoast meta is managed separately.
  const yoastMeta = city !== 'Orangeville' ? buildYoastMeta(city, stats) : null;

  console.log(`[wordpress] Pushing updated content for "${city}" (page ${pageId})…`);
  await updatePageContent(pageId, content, yoastMeta);
  console.log(`[wordpress] ✓ "${city}" updated successfully.`);

  return { updated: true, pageId, city };
}

/**
 * Check whether WordPress credentials are present in the environment.
 */
function isConfigured() {
  return !!(
    process.env.WP_SITE_URL &&
    process.env.WP_USERNAME &&
    process.env.WP_APP_PASSWORD
  );
}

module.exports = {
  updateWordPressPage,
  fetchPageContent,
  isConfigured,
  // Exported for unit testing / preview:
  buildStatsSection,
  buildInventorySection,
  buildRankingsSection,
  buildPriceTablesSection,
  buildInventoryTablesSection,
  applyIntroUpdates,
  formatPriceShort,
  formatPriceFull,
  formatPct,
  ordinal,
};
