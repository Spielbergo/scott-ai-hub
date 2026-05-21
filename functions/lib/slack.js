/**
 * lib/slack.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends structured executive-summary reports to a Slack channel via
 * an Incoming Webhook URL.
 *
 * Uses the Slack Block Kit layout for clean, readable messages.
 * No additional npm package is required — we use axios directly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const axios = require("axios");

const SLACK_TIMEOUT_MS = 8000;

/**
 * Format a number as a Canadian-dollar currency string.
 * @param {number|null} value
 * @returns {string}
 */
function formatCurrency(value) {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(value);
}

/**
 * Format a plain number with thousand separators.
 * @param {number|null} value
 * @param {number} [decimals=0]
 * @returns {string}
 */
function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined) return "N/A";
  return value.toLocaleString("en-CA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Build a Slack Block Kit section for one city's market stats.
 * @param {{city: string, cleanStats: Object, anomalies: string[], iqrFlags: Object}} cityResult
 * @returns {Object[]} Array of Slack blocks
 */
function buildCityBlock(cityResult) {
  const { city, cleanStats: s, anomalies, iqrFlags } = cityResult;
  const flaggedKeys = Object.keys(iqrFlags || {});
  const warningLine = flaggedKeys.length > 0
    ? `\n⚠️ IQR flags: ${flaggedKeys.join(", ")}`
    : "";
  const anomalyLine = (anomalies || []).length > 0
    ? `\n🚫 Anomalies stripped: ${anomalies.length}`
    : "";

  const rows = [
    `*Median Sale Price:* ${formatCurrency(s.medianSalePrice)}`,
    `*Avg Sale Price:* ${formatCurrency(s.avgSalePrice)}`,
    `*Price / sq ft:* ${formatCurrency(s.pricePerSqft)}`,
    `*Days on Market:* ${formatNumber(s.daysOnMarket)} days`,
    `*Active Listings:* ${formatNumber(s.activeListings)}`,
    `*Sold Listings:* ${formatNumber(s.soldListings)}`,
    `*Months of Inventory:* ${formatNumber(s.monthsOfInventory, 1)}`,
  ].join("\n");

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📍 *${city.replace(/-/g, " ").toUpperCase()}*\n${rows}${warningLine}${anomalyLine}`,
      },
    },
    { type: "divider" },
  ];
}

/**
 * Send a Market Trend Agent completion report to Slack.
 *
 * @param {string} webhookUrl  Slack Incoming Webhook URL
 * @param {{
 *   runAt: string,
 *   citiesProcessed: number,
 *   citiesSucceeded: number,
 *   cityResults: Array<{city, cleanStats, anomalies, iqrFlags, error}>
 * }} report
 * @returns {Promise<void>}
 */
async function sendMarketTrendReport(webhookUrl, report) {
  if (!webhookUrl) {
    console.warn("[slack] SLACK_WEBHOOK_URL not configured — skipping notification.");
    return;
  }

  const { runAt, citiesProcessed, citiesSucceeded, cityResults } = report;
  const runDate = new Date(runAt).toLocaleDateString("en-CA", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const headerBlocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "📊 Scott AI — Market Trend Report", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Run Date:*\n${runDate}` },
        { type: "mrkdwn", text: `*Cities Updated:*\n${citiesSucceeded} / ${citiesProcessed}` },
      ],
    },
    { type: "divider" },
  ];

  const cityBlocks = cityResults.flatMap((r) => {
    if (r.error) {
      return [
        {
          type: "section",
          text: { type: "mrkdwn", text: `❌ *${r.city.toUpperCase()}* — Scrape failed: ${r.error}` },
        },
        { type: "divider" },
      ];
    }
    return buildCityBlock(r);
  });

  const footerBlocks = [
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Scott AI Market Trend Agent · ${runAt} · All data sourced from Zolo.ca_`,
        },
      ],
    },
  ];

  const payload = {
    blocks: [...headerBlocks, ...cityBlocks, ...footerBlocks],
  };

  try {
    await axios.post(webhookUrl, payload, { timeout: SLACK_TIMEOUT_MS });
    console.log("[slack] Market trend report sent successfully.");
  } catch (err) {
    // Log but don't rethrow — Slack failure should not block the agent run
    console.error(`[slack] Failed to send report: ${err.message}`);
  }
}

/**
 * Send a simple error alert to Slack.
 * @param {string} webhookUrl
 * @param {string} agentName
 * @param {string} errorMessage
 * @returns {Promise<void>}
 */
async function sendErrorAlert(webhookUrl, agentName, errorMessage) {
  if (!webhookUrl) return;
  const payload = {
    text: `🔴 *Scott AI — ${agentName} ERROR*\n\`\`\`${errorMessage}\`\`\``,
  };
  try {
    await axios.post(webhookUrl, payload, { timeout: SLACK_TIMEOUT_MS });
  } catch (err) {
    console.error(`[slack] Failed to send error alert: ${err.message}`);
  }
}

module.exports = { sendMarketTrendReport, sendErrorAlert };
