/**
 * pages/api/run-agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/run-agent  → triggers the GitHub Actions pipeline via workflow dispatch
 * GET  /api/run-agent  → returns last saved results from Firestore
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const GITHUB_OWNER  = process.env.GITHUB_OWNER;   // e.g. "Spielbergo"
const GITHUB_REPO   = process.env.GITHUB_REPO;    // e.g. "scott-ai-hub"
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;   // Fine-grained PAT (actions: write)
const WORKFLOW_FILE = 'run-pipeline.yml';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { getRecentRuns } = require('../../lib/runHistory');
    try {
      const runs = await getRecentRuns('market-trends', 1);
      if (!runs || runs.length === 0) {
        return res.status(200).json({ status: 'no-data', cities: [] });
      }
      return res.status(200).json(runs[0]);
    } catch (err) {
      console.error('[api/run-agent] GET error:', err);
      return res.status(500).json({ status: 'error', message: err.message });
    }
  }

  if (req.method === 'POST') {
    if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN) {
      return res.status(500).json({
        error: 'Server not configured: GITHUB_OWNER, GITHUB_REPO and GITHUB_TOKEN env vars are required.',
      });
    }

    try {
      const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

      const response = await fetch(url, {
        method:  'POST',
        headers: {
          Authorization:          `Bearer ${GITHUB_TOKEN}`,
          Accept:                 'application/vnd.github+json',
          'Content-Type':         'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref:    'main',
          inputs: { triggered_by: 'dashboard' },
        }),
      });

      // GitHub returns 204 No Content on success
      if (response.status === 204) {
        return res.status(200).json({ status: 'triggered' });
      }

      const body = await response.json().catch(() => ({}));
      console.error('[api/run-agent] GitHub dispatch failed:', response.status, body);
      return res.status(502).json({ error: body.message || 'Failed to trigger workflow' });
    } catch (err) {
      console.error('[api/run-agent] fetch error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}
