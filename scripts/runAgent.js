/**
 * scripts/runAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CLI runner for the Market Trend Agent.
 *
 * Usage:
 *   npm run agent
 *   (or: node -r dotenv/config scripts/runAgent.js dotenv_config_path=.env.local)
 *
 * Reads API keys from .env.local in the project root.
 * Results are saved to data/results.json.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

// dotenv is loaded via the npm script flag: node -r dotenv/config ...
const { run } = require("../lib/agent");

run()
  .then((results) => {
    console.log(`\nStatus : ${results.status}`);
    console.log(`Summary: ${results.summary}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n[runAgent] Fatal error:", err.message);
    process.exit(1);
  });
