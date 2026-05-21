'use strict';

/**
 * lib/alerts.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Email alerting via Resend.
 *
 * Required env vars (all optional — skips gracefully if absent):
 *   RESEND_API_KEY
 *   ALERT_EMAIL_TO    (recipient address)
 *   ALERT_EMAIL_FROM  (verified sender, e.g. "alerts@yourdomain.com")
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Send a run-summary / alert email.
 * Silently skips if credentials are not configured.
 *
 * @param {Object} runRecord – the object saved to Firestore by fullPipeline.js
 */
async function sendAlertEmail(runRecord) {
  const apiKey   = process.env.RESEND_API_KEY;
  const toEmail  = process.env.ALERT_EMAIL_TO;
  const fromEmail = process.env.ALERT_EMAIL_FROM || 'alerts@scottaihub.com';

  if (!apiKey || !toEmail) {
    console.log('[alerts] RESEND_API_KEY or ALERT_EMAIL_TO not set — skipping email.');
    return;
  }

  const isOk      = runRecord.status === 'success';
  const dateLabel = new Date(runRecord.startedAt).toLocaleDateString('en-CA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const subject = isOk
    ? `✓ Market Trends updated — ${dateLabel}`
    : `⚠ Market Trends issues — ${dateLabel}`;

  const html = buildEmailHtml(runRecord, dateLabel);

  try {
    const { Resend } = require('resend');
    const resend     = new Resend(apiKey);
    const result     = await resend.emails.send({ from: fromEmail, to: toEmail, subject, html });
    console.log(`[alerts] Email sent — id: ${result.data?.id ?? 'ok'}`);
  } catch (err) {
    console.error(`[alerts] Failed to send email: ${err.message}`);
  }
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildEmailHtml(run, dateLabel) {
  const statusColor = run.status === 'success' ? '#10b981' : '#ef4444';

  const cityRows = (run.cities || []).map((c) => {
    const scrapeColor = c.status === 'success' ? '#10b981' : '#ef4444';
    const wpColor     = c.wpStatus === 'updated' ? '#10b981' : '#f59e0b';
    const price       = c.avgSalePrice
      ? '$' + Number(c.avgSalePrice).toLocaleString('en-CA')
      : '—';
    const anomalyHtml = (c.anomalies || []).length
      ? `<br><span style="color:#f59e0b;font-size:11px">⚠ ${c.anomalies.map((a) => a.message).join(' · ')}</span>`
      : '';
    return `
      <tr>
        <td style="padding:8px 14px;border-bottom:1px solid #374151;font-weight:600">${c.city}</td>
        <td style="padding:8px 14px;border-bottom:1px solid #374151;color:${scrapeColor}">${c.status}${anomalyHtml}</td>
        <td style="padding:8px 14px;border-bottom:1px solid #374151;color:${wpColor}">${c.wpStatus || '—'}</td>
        <td style="padding:8px 14px;border-bottom:1px solid #374151;font-family:monospace">${price}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f1f5f9">
  <div style="max-width:580px;margin:32px auto;padding:0 16px">

    <!-- Header -->
    <div style="background:#1e293b;border-radius:12px 12px 0 0;padding:24px 28px;border-bottom:1px solid #334155">
      <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Scott AI Hub</p>
      <h1 style="margin:0;font-size:20px;font-weight:700">Market Trends Agent</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#94a3b8">${dateLabel}</p>
    </div>

    <!-- Summary -->
    <div style="background:#1e293b;padding:20px 28px;display:flex;gap:32px">
      <div>
        <p style="margin:0 0 2px;font-size:11px;color:#64748b;text-transform:uppercase">Status</p>
        <p style="margin:0;font-size:16px;font-weight:700;color:${statusColor}">${run.status}</p>
      </div>
      <div>
        <p style="margin:0 0 2px;font-size:11px;color:#64748b;text-transform:uppercase">Triggered by</p>
        <p style="margin:0;font-size:16px;font-weight:700">${run.triggeredBy}</p>
      </div>
      <div>
        <p style="margin:0 0 2px;font-size:11px;color:#64748b;text-transform:uppercase">Summary</p>
        <p style="margin:0;font-size:14px;color:#cbd5e1">${run.summary}</p>
      </div>
    </div>

    <!-- City table -->
    <table style="width:100%;border-collapse:collapse;background:#1e293b">
      <thead>
        <tr style="background:#0f172a">
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px">City</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px">Scrape</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px">WordPress</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px">Avg Price</th>
        </tr>
      </thead>
      <tbody>${cityRows}</tbody>
    </table>

    <!-- Footer -->
    <div style="background:#1e293b;border-radius:0 0 12px 12px;padding:16px 28px;border-top:1px solid #334155">
      <p style="margin:0;font-size:11px;color:#475569">
        Scott AI Hub · Market Trends Agent · Automated report
      </p>
    </div>

  </div>
</body>
</html>`;
}

module.exports = { sendAlertEmail };
