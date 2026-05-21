/**
 * pages/api/agent-config.js
 *
 * GET  /api/agent-config?agent=market-trends  → returns stored config
 * PATCH /api/agent-config?agent=market-trends  body: { enabled?, schedule? }
 */

export default async function handler(req, res) {
  const agentId = req.query.agent || 'market-trends';

  if (req.method === 'GET') {
    if (!process.env.FIREBASE_PROJECT_ID) {
      return res.status(200).json({ config: null });
    }
    try {
      const { loadAgentConfig } = require('../../lib/runHistory');
      const config = await loadAgentConfig(agentId);
      return res.status(200).json({ config });
    } catch (err) {
      return res.status(500).json({ error: err.message, config: null });
    }
  }

  if (req.method === 'PATCH') {
    if (!process.env.FIREBASE_PROJECT_ID) {
      return res.status(503).json({ error: 'Firebase not configured' });
    }
    try {
      const { saveAgentConfig } = require('../../lib/runHistory');
      const { enabled, schedule } = req.body;
      const update = {};
      if (enabled !== undefined) update.enabled  = enabled;
      if (schedule !== undefined) update.schedule = schedule;
      await saveAgentConfig(agentId, update);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
