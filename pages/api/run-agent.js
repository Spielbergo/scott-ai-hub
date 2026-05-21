/**
 * pages/api/run-agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Next.js API route for the dashboard to trigger or read agent results.
 *
 * GET  /api/run-agent  → returns last saved results (or { status: "no-data" })
 * POST /api/run-agent  → runs the agent and streams back results when done
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

export default async function handler(req, res) {
  const { run, readLastResults } = require("../../lib/agent");
  // Load env from .env.local in Next.js dev mode — Next.js handles this automatically,
  // but the agent lib also reads process.env which Next.js has already populated.

  if (req.method === "GET") {
    const results = readLastResults();
    if (!results) {
      return res.status(200).json({ status: "no-data", cities: [] });
    }
    return res.status(200).json(results);
  }

  if (req.method === "POST") {
    try {
      const results = await run();
      return res.status(200).json(results);
    } catch (err) {
      console.error("[api/run-agent] Error:", err);
      return res.status(500).json({ status: "error", message: err.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: "Method not allowed" });
};
