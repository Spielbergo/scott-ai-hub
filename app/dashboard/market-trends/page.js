"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import UserMenu from "../../components/UserMenu";

// ─── Schedule helpers ─────────────────────────────────────────────────────────

const DOW_LABELS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function buildCron({ frequency, dayOfWeek, hour, minute }) {
  const h = hour   ?? 10;
  const m = minute ?? 0;
  const d = dayOfWeek ?? 1;
  if (frequency === "monthly")  return `${m} ${h} 1 * *`;
  if (frequency === "biweekly") return `${m} ${h} 1,15 * *`;
  return `${m} ${h} * * ${d}`;
}

function nextRunLabel(schedule) {
  try {
    const cron  = buildCron(schedule);
    const parts = cron.split(" ");
    if (parts.length !== 5) return "Unknown";
    const [min, hour, dom] = parts;
    const now = new Date();

    if (dom.includes(",")) {
      const days = dom.split(",").map(Number);
      for (const day of days) {
        const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, Number(hour), Number(min)));
        if (t > now) return t.toLocaleDateString("en-CA", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"UTC" }) + " UTC";
      }
      const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()+1, days[0], Number(hour), Number(min)));
      return t.toLocaleDateString("en-CA", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"UTC" }) + " UTC";
    }

    const targetDow = schedule.dayOfWeek ?? 1;
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(hour), Number(min)));
    const currentDow = t.getUTCDay();
    let ahead = (targetDow - currentDow + 7) % 7;
    if (ahead === 0 && t <= now) ahead = 7;
    t.setUTCDate(t.getUTCDate() + ahead);
    return t.toLocaleDateString("en-CA", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"UTC" }) + " UTC";
  } catch {
    return "Unknown";
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatCAD(n) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-CA", { style:"currency", currency:"CAD", maximumFractionDigits:0 }).format(n);
}

function formatNum(n, decimals = 0) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-CA", { minimumFractionDigits:decimals, maximumFractionDigits:decimals });
}

function relativeTime(iso) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-CA");
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    success:      "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    partial:      "bg-yellow-500/20  text-yellow-300  border-yellow-500/30",
    failed:       "bg-red-500/20     text-red-300     border-red-500/30",
    scrape_error: "bg-red-500/20     text-red-300     border-red-500/30",
    ai_error:     "bg-orange-500/20  text-orange-300  border-orange-500/30",
    no_data:      "bg-gray-500/20    text-gray-400    border-gray-500/30",
  };
  const label = {
    success:"Success", partial:"Partial", failed:"Failed",
    scrape_error:"Scrape Error", ai_error:"AI Error", no_data:"No Data",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${map[status] || map.no_data}`}>
      {label[status] || status}
    </span>
  );
}

function MarketBadge({ condition }) {
  if (!condition) return null;
  const map = {
    "Seller's Market": "bg-rose-500/20   text-rose-300   border-rose-500/30",
    "Buyer's Market":  "bg-blue-500/20   text-blue-300   border-blue-500/30",
    "Balanced Market": "bg-violet-500/20 text-violet-300 border-violet-500/30",
  };
  return (
    <span className={`inline-block px-3 py-1 rounded-full border text-xs font-semibold ${map[condition] || "bg-gray-700 text-gray-300"}`}>
      {condition}
    </span>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner({ large = false }) {
  const size = large ? "w-8 h-8 border-2" : "w-4 h-4 border-2";
  return (
    <div className={`${size} border-current border-t-transparent rounded-full animate-spin opacity-70`} />
  );
}

function SummaryTile({ label, value, sub }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
      <p className="text-xs text-gray-500">{sub}</p>
    </div>
  );
}

function StatGrid({ stats }) {
  if (!stats || Object.keys(stats).length === 0)
    return <p className="text-gray-500 text-sm italic">No stats scraped.</p>;

  const display = [
    { key:"medianSalePrice",   label:"Median Sale Price",   fmt:formatCAD },
    { key:"avgSalePrice",      label:"Avg Sale Price",      fmt:formatCAD },
    { key:"pricePerSqft",      label:"Price / sq ft",       fmt:formatCAD },
    { key:"daysOnMarket",      label:"Days on Market",      fmt:(n) => `${formatNum(n)} days` },
    { key:"activeListings",    label:"Active Listings",     fmt:formatNum },
    { key:"soldListings",      label:"Sold Listings",       fmt:formatNum },
    { key:"monthsOfInventory", label:"Months of Inventory", fmt:(n) => formatNum(n,1) },
  ];

  const extraKeys = Object.keys(stats).filter(
    (k) => !display.find((d) => d.key === k) && stats[k] !== null
  );

  return (
    <div className="grid grid-cols-2 gap-2">
      {display.map(({ key, label, fmt }) =>
        stats[key] !== null && stats[key] !== undefined ? (
          <div key={key} className="bg-gray-800/60 rounded-lg p-3">
            <p className="text-gray-400 text-xs mb-0.5">{label}</p>
            <p className="text-white font-semibold text-sm">{fmt(stats[key])}</p>
          </div>
        ) : null
      )}
      {extraKeys.map((key) => (
        <div key={key} className="bg-gray-800/60 rounded-lg p-3">
          <p className="text-gray-400 text-xs mb-0.5">{key}</p>
          <p className="text-white font-semibold text-sm">{String(stats[key])}</p>
        </div>
      ))}
    </div>
  );
}

function TableRowPreview({ tableRow }) {
  if (!tableRow) return null;
  const cols = [
    { key:"month",            label:"Month" },
    { key:"medianSalePrice",  label:"Median Price",  fmt:formatCAD },
    { key:"avgSalePrice",     label:"Avg Price",     fmt:formatCAD },
    { key:"soldListings",     label:"Sold",          fmt:formatNum },
    { key:"activeListings",   label:"Active",        fmt:formatNum },
    { key:"daysOnMarket",     label:"Days on Mkt",   fmt:formatNum },
    { key:"monthsOfInventory",label:"Mo. Inventory", fmt:(n) => formatNum(n,1) },
  ];
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-gray-700">
            {cols.map((c) => (
              <th key={c.key} className="text-left text-gray-400 font-medium py-2 pr-4 whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {cols.map((c) => {
              const val = tableRow[c.key];
              return (
                <td key={c.key} className="text-white py-2 pr-4 whitespace-nowrap font-medium">
                  {c.fmt ? c.fmt(val) : (val ?? "—")}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white"
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}

function PushToWpButton({ city, disabled }) {
  const [state, setState]       = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handlePush = async () => {
    setState("loading");
    setErrorMsg("");
    try {
      const res  = await fetch("/api/push-to-wordpress", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ city }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Unknown error");
      setState("success");
      setTimeout(() => setState("idle"), 4000);
    } catch (err) {
      setErrorMsg(err.message);
      setState("error");
      setTimeout(() => setState("idle"), 6000);
    }
  };

  const styles = {
    idle:    "bg-emerald-600 hover:bg-emerald-500 text-white",
    loading: "bg-gray-600 text-gray-300 cursor-not-allowed",
    success: "bg-emerald-700 text-emerald-200 cursor-default",
    error:   "bg-red-700 text-red-200 cursor-default",
  };
  const labels = {
    idle:"Push to WordPress", loading:"Pushing…",
    success:"✓ Live on WordPress", error:"✗ Push Failed",
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handlePush}
        disabled={disabled || state === "loading" || state === "success"}
        className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${styles[state]}`}
      >
        {labels[state]}
      </button>
      {state === "error" && errorMsg && (
        <span className="text-xs text-red-400 max-w-[220px] text-right">{errorMsg}</span>
      )}
    </div>
  );
}

function CityCard({ cityData }) {
  const { city, zoloUrl, wpUrl, status, stats, aiContent, aiError, error, scrapedAt, anomalies, missingKeys } = cityData;
  const canPush = status === "success" || status === "ai_error";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
        <div>
          <h2 className="text-xl font-bold text-white">{city}</h2>
          <div className="flex gap-3 mt-1">
            <a href={zoloUrl} target="_blank" rel="noopener noreferrer"
               className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2">Zolo Source ↗</a>
            <a href={wpUrl}   target="_blank" rel="noopener noreferrer"
               className="text-xs text-emerald-400 hover:text-emerald-300 underline underline-offset-2">WordPress Page ↗</a>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={status} />
          {aiContent?.marketCondition && <MarketBadge condition={aiContent.marketCondition} />}
          <PushToWpButton city={city} disabled={!canPush} />
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Scraped Stats</h3>
            {scrapedAt && <span className="text-xs text-gray-500">{relativeTime(scrapedAt)}</span>}
          </div>
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
              Scrape failed: {error}
            </div>
          )}
          {!error && <StatGrid stats={stats} />}
          {anomalies?.length > 0 && (
            <p className="text-yellow-500 text-xs mt-2">⚠ {anomalies.length} anomal{anomalies.length===1?"y":"ies"} stripped</p>
          )}
          {missingKeys?.length > 0 && (
            <p className="text-gray-500 text-xs mt-1">Missing: {missingKeys.join(", ")}</p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Generated WordPress Content</h3>
          {aiError && (
            <div className="bg-orange-900/30 border border-orange-800 rounded-lg p-3 text-orange-300 text-sm">
              Gemini error: {aiError}
            </div>
          )}
          {aiContent && (
            <div className="space-y-4">
              <div className="bg-gray-800/60 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Intro Paragraph</p>
                  <CopyButton text={aiContent.introParagraph} />
                </div>
                <p className="text-gray-200 text-sm leading-relaxed">{aiContent.introParagraph || "—"}</p>
              </div>
              {aiContent.keyInsight && (
                <div className="bg-gray-800/60 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Key Insight</p>
                    <CopyButton text={aiContent.keyInsight} />
                  </div>
                  <p className="text-gray-200 text-sm leading-relaxed">{aiContent.keyInsight}</p>
                </div>
              )}
              {aiContent.lastUpdated && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Last Updated:</span>
                  <span className="text-xs text-white font-medium bg-gray-800 px-2 py-0.5 rounded">{aiContent.lastUpdated}</span>
                  <CopyButton text={aiContent.lastUpdated} />
                </div>
              )}
              {aiContent.tableRow && (
                <div className="bg-gray-800/60 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">New Table Row</p>
                    <CopyButton text={Object.values(aiContent.tableRow).join("\t")} label="Copy as TSV" />
                  </div>
                  <TableRowPreview tableRow={aiContent.tableRow} />
                </div>
              )}
            </div>
          )}
          {!aiContent && !aiError && (
            <p className="text-gray-500 text-sm italic">Run the agent to generate content.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Agent config panel ───────────────────────────────────────────────────────

function AgentConfigPanel({ agentId }) {
  const [enabled,  setEnabled]  = useState(true);
  const [schedule, setSchedule] = useState({ frequency:"weekly", dayOfWeek:1, hour:10, minute:0 });
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [loaded,   setLoaded]   = useState(false);

  useEffect(() => {
    fetch(`/api/agent-config?agent=${agentId}`)
      .then((r) => r.json())
      .then(({ config }) => {
        if (config) {
          setEnabled(config.enabled ?? true);
          if (config.schedule) setSchedule(config.schedule);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [agentId]);

  const patchConfig = async (patch) => {
    await fetch(`/api/agent-config?agent=${agentId}`, {
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(patch),
    }).catch(() => {});
  };

  const handleToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await patchConfig({ enabled: next });
  };

  const handleSave = async () => {
    setSaving(true);
    const cron = buildCron(schedule);
    await patchConfig({ schedule: { ...schedule, cronExpression: cron } });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (!loaded) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Agent Settings</h2>
        {/* Enable / disable toggle */}
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${enabled ? "text-emerald-400" : "text-gray-500"}`}>
            {enabled ? "Enabled" : "Disabled"}
          </span>
          <button
            onClick={handleToggle}
            aria-label="Toggle agent"
            className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
              enabled ? "bg-emerald-600" : "bg-gray-700"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Frequency */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Frequency</label>
          <select
            value={schedule.frequency}
            onChange={(e) => setSchedule((s) => ({ ...s, frequency: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly (1st)</option>
          </select>
        </div>

        {/* Day of week — only shown for weekly */}
        {schedule.frequency === "weekly" && (
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Day (UTC)</label>
            <select
              value={schedule.dayOfWeek}
              onChange={(e) => setSchedule((s) => ({ ...s, dayOfWeek: Number(e.target.value) }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
            >
              {DOW_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
        )}

        {/* Time */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Time (UTC)</label>
          <input
            type="time"
            value={`${String(schedule.hour ?? 10).padStart(2,"0")}:${String(schedule.minute ?? 0).padStart(2,"0")}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":");
              setSchedule((s) => ({ ...s, hour: Number(h), minute: Number(m) }));
            }}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800">
        <p className="text-xs text-gray-600">
          Cron:{" "}
          <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-400 font-mono">
            {buildCron(schedule)}
          </code>
          {" · "}Next: <span className="text-gray-400">{nextRunLabel(schedule)}</span>
        </p>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Schedule"}
        </button>
      </div>
    </div>
  );
}

// ─── Run History ──────────────────────────────────────────────────────────────

const RUN_STATUS_STYLE = {
  success: "text-emerald-400",
  partial: "text-yellow-400",
  failed:  "text-red-400",
};
const WP_STATUS_STYLE = {
  updated:                "text-emerald-400",
  error:                  "text-red-400",
  skipped_anomaly:        "text-yellow-400",
  skipped_scrape_error:   "text-red-400",
  skipped_no_page_id:     "text-gray-500",
  skipped_not_configured: "text-gray-500",
};
const WP_STATUS_LABEL = {
  updated:                "✓ pushed",
  error:                  "✗ error",
  skipped_anomaly:        "⚠ anomaly",
  skipped_scrape_error:   "⚠ scrape fail",
  skipped_no_page_id:     "— no ID",
  skipped_not_configured: "— no config",
};

function RunHistory({ runs }) {
  if (!runs || runs.length === 0) return null;
  return (
    <div className="mt-10">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Run History</h2>
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Triggered by</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3 hidden sm:table-cell">Summary</th>
              {(runs[0]?.cities || []).map((c) => (
                <th key={c.city} className="text-left px-4 py-3 hidden md:table-cell">{c.city}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                  {run.startedAt
                    ? new Date(run.startedAt).toLocaleDateString("en-CA", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })
                    : "—"}
                </td>
                <td className="px-4 py-3 text-gray-400 capitalize whitespace-nowrap">
                  {run.triggeredBy?.replace(/-/g, " ") || "—"}
                </td>
                <td className={`px-4 py-3 font-semibold capitalize whitespace-nowrap ${RUN_STATUS_STYLE[run.status] || "text-gray-400"}`}>
                  {run.status}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs hidden sm:table-cell">{run.summary}</td>
                {(run.cities || []).map((c) => (
                  <td key={c.city} className="px-4 py-3 hidden md:table-cell">
                    <div className={`text-xs font-medium ${WP_STATUS_STYLE[c.wpStatus] || "text-gray-400"}`}>
                      {WP_STATUS_LABEL[c.wpStatus] || c.wpStatus || "—"}
                    </div>
                    {c.avgSalePrice && (
                      <div className="text-xs text-gray-500 font-mono mt-0.5">${Math.round(c.avgSalePrice / 1000)}K</div>
                    )}
                    {(c.anomalies || []).length > 0 && (
                      <div className="text-xs text-yellow-500 mt-0.5">⚠ {c.anomalies.length} anomal{c.anomalies.length===1?"y":"ies"}</div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Market Trends Page ───────────────────────────────────────────────────────

export default function MarketTrendsPage() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [triggered, setTriggered] = useState(false);
  const [polling,   setPolling]   = useState(false);
  const [history,   setHistory]   = useState([]);

  const fetchResults = useCallback(async () => {
    try {
      const res  = await fetch("/api/run-agent");
      const json = await res.json();
      setData(json);
      return json;
    } catch (err) {
      console.error("Failed to fetch results:", err);
      return null;
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/run-history");
      if (!res.ok) return;
      const json = await res.json();
      setHistory(json.runs || []);
    } catch {
      // Firebase not configured — silently skip
    }
  }, []);

  useEffect(() => {
    fetchResults();
    fetchHistory();
  }, [fetchResults, fetchHistory]);

  const handleRunAgent = async () => {
    setLoading(true);
    setError(null);
    setTriggered(false);
    try {
      const res  = await fetch("/api/run-agent", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Failed to trigger agent");
      setTriggered(true);

      // Poll every 10 s for up to 3 minutes for new results
      const currentRunAt = data?.runAt || null;
      setPolling(true);
      const INTERVAL = 10_000;
      const MAX_ATTEMPTS = 18; // 3 min
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const fresh = await fetchResults();
        const newRunAt = fresh?.runAt || null;
        if (newRunAt && newRunAt !== currentRunAt) {
          clearInterval(poll);
          setPolling(false);
          setTriggered(false);
          fetchHistory();
        } else if (attempts >= MAX_ATTEMPTS) {
          clearInterval(poll);
          setPolling(false);
        }
      }, INTERVAL);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const cities  = data?.cities || [];
  const hasData = data && data.status !== "no-data";

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Top nav */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/dashboard"
            className="text-gray-500 hover:text-gray-300 text-sm transition-colors flex items-center gap-1.5">
            ← Hub
          </Link>
          <div className="w-px h-5 bg-gray-800" />
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white tracking-tight">Market Trends</h1>
            <p className="text-xs text-gray-400 mt-0.5">jenjewell.ca · Orangeville, Caledon, Shelburne</p>
          </div>
          <div className="flex items-center gap-4">
            {hasData && (
              <span className="text-xs text-gray-500">Last run: {relativeTime(data.runAt)}</span>
            )}
            <button
              onClick={handleRunAgent}
              disabled={loading}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                loading
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30"
              }`}
            >
              {loading ? <><Spinner />Running…</> : <><span>▶</span> Run Agent</>}
            </button>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Agent config panel */}
        <AgentConfigPanel agentId="market-trends" />

        {/* Triggered / polling banner */}
        {triggered && (
          <div className="bg-emerald-900/30 border border-emerald-700 rounded-xl p-4 text-emerald-300 text-sm flex items-center gap-3">
            {polling ? <Spinner /> : <span className="text-lg">✓</span>}
            <div>
              <p className="font-semibold">{polling ? "Pipeline running on GitHub Actions…" : "Pipeline triggered"}</p>
              <p className="text-emerald-400 mt-0.5">
                {polling
                  ? "Checking for new results every 10 seconds. This page will update automatically."
                  : "Results updated successfully."}
              </p>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Loading banner */}
        {loading && (
          <div className="bg-blue-900/30 border border-blue-800 rounded-xl p-5 flex items-center gap-4">
            <Spinner large />
            <div>
              <p className="text-blue-300 font-semibold">Agent is running…</p>
              <p className="text-blue-400 text-sm mt-0.5">
                Scraping Zolo + generating content with Gemini. ~30–60 seconds.
              </p>
            </div>
          </div>
        )}

        {/* Summary bar */}
        {hasData && !loading && (
          <div className="grid grid-cols-3 gap-4">
            <SummaryTile
              label="Cities Processed"
              value={`${cities.filter((c) => c.status !== "scrape_error").length} / ${cities.length}`}
              sub="scraped successfully"
            />
            <SummaryTile
              label="Content Generated"
              value={`${cities.filter((c) => c.aiContent).length} / ${cities.length}`}
              sub="Gemini responses"
            />
            <SummaryTile
              label="Overall Status"
              value={<StatusBadge status={data.status} />}
              sub={data.summary}
            />
          </div>
        )}

        {/* Empty state */}
        {!hasData && !loading && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-6xl mb-4">📊</div>
            <h2 className="text-2xl font-bold text-white mb-2">No Data Yet</h2>
            <p className="text-gray-400 mb-6 max-w-md">
              Click <strong>Run Agent</strong> to scrape Zolo and generate updated WordPress content.
            </p>
            <p className="text-xs text-gray-600">
              Make sure <code className="bg-gray-800 px-1 rounded">.env.local</code> has{" "}
              <code className="bg-gray-800 px-1 rounded">GEMINI_API_KEY</code> set.
            </p>
          </div>
        )}

        {/* City cards */}
        {hasData && (
          <div className="space-y-6">
            {cities.map((city) => (
              <CityCard key={city.city} cityData={city} />
            ))}
          </div>
        )}

        {/* Run history */}
        <RunHistory runs={history} />

      </main>
    </div>
  );
}
