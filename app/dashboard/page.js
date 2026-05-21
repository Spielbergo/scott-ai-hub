"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// ─── Static agent registry ────────────────────────────────────────────────────

const AGENTS = [
  {
    id:          "market-trends",
    name:        "Market Trends",
    emoji:       "📊",
    description: "Scrapes Zolo.ca for Orangeville, Caledon & Shelburne, generates AI-written content with Gemini, and pushes directly to jenjewell.ca.",
    href:        "/dashboard/market-trends",
    tags:        ["WordPress", "Zolo", "Gemini"],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function nextCronRun(cron) {
  try {
    const parts = (cron || "").trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [min, hour, dom] = parts;
    const dow = parts[4];
    const now = new Date();

    if (dom.includes(",")) {
      const days = dom.split(",").map(Number);
      for (const d of days) {
        const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, Number(hour), Number(min)));
        if (t > now) return t;
      }
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, days[0], Number(hour), Number(min)));
    }

    const targetDow = Number(dow);
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(hour), Number(min)));
    const ahead = ((targetDow - t.getUTCDay()) + 7) % 7 || (t <= now ? 7 : 0);
    t.setUTCDate(t.getUTCDate() + ahead);
    return t;
  } catch {
    return null;
  }
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }) {
  if (!status) return <span className="text-xs text-gray-600">No runs yet</span>;
  const map = {
    success: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    partial: "bg-yellow-500/20  text-yellow-300  border-yellow-500/30",
    failed:  "bg-red-500/20     text-red-300     border-red-500/30",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${map[status] || "bg-gray-700/50 text-gray-400 border-gray-700"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── Agent card ───────────────────────────────────────────────────────────────

function AgentCard({ agent, latestRun, config, onToggle }) {
  const enabled    = config?.enabled ?? true;
  const cron       = config?.schedule?.cronExpression || "0 10 * * 1";
  const nextRun    = nextCronRun(cron);
  const nextLabel  = nextRun
    ? nextRun.toLocaleDateString("en-CA", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"UTC" }) + " UTC"
    : "—";

  return (
    <div className={`bg-gray-900 border rounded-2xl overflow-hidden transition-opacity ${enabled ? "border-gray-800" : "border-gray-800/50 opacity-60"}`}>
      {/* Header */}
      <div className="flex items-start justify-between px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="text-3xl">{agent.emoji}</div>
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">{agent.name}</h2>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {agent.tags.map((t) => (
                <span key={t} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Toggle */}
        <button
          onClick={() => onToggle(agent.id, !enabled)}
          aria-label={enabled ? "Disable agent" : "Enable agent"}
          className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
            enabled ? "bg-emerald-600" : "bg-gray-700"
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`} />
        </button>
      </div>

      {/* Description */}
      <p className="px-6 pb-4 text-sm text-gray-400 leading-relaxed">{agent.description}</p>

      {/* Stats row */}
      <div className="px-6 pb-4 grid grid-cols-3 gap-3 border-t border-gray-800 pt-4">
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">Last run</p>
          <p className="text-sm text-gray-300">{relativeTime(latestRun?.startedAt || latestRun?.createdAt) || "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">Status</p>
          <StatusPill status={latestRun?.status} />
        </div>
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">Next run</p>
          <p className="text-sm text-gray-300">{enabled ? nextLabel : <span className="text-gray-600">Paused</span>}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
        <p className="text-xs text-gray-600 font-mono">{cron}</p>
        <Link
          href={agent.href}
          className="text-sm font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
        >
          Open agent →
        </Link>
      </div>
    </div>
  );
}

// ─── Placeholder "add agent" card ─────────────────────────────────────────────

function AddAgentCard() {
  return (
    <div className="border-2 border-dashed border-gray-800 rounded-2xl flex flex-col items-center justify-center py-12 px-6 text-center hover:border-gray-700 transition-colors">
      <div className="text-3xl mb-3 opacity-40">＋</div>
      <p className="text-gray-500 font-semibold text-sm">Add Agent</p>
      <p className="text-gray-700 text-xs mt-1">New agents will appear here</p>
    </div>
  );
}

// ─── Hub page ─────────────────────────────────────────────────────────────────

export default function HubPage() {
  const [runs,    setRuns]    = useState([]);
  const [configs, setConfigs] = useState({});

  useEffect(() => {
    // Fetch latest run for the history badge
    fetch("/api/run-history")
      .then((r) => r.json())
      .then(({ runs }) => setRuns(runs || []))
      .catch(() => {});

    // Fetch config for every agent
    AGENTS.forEach(({ id }) => {
      fetch(`/api/agent-config?agent=${id}`)
        .then((r) => r.json())
        .then(({ config }) => {
          if (config) setConfigs((prev) => ({ ...prev, [id]: config }));
        })
        .catch(() => {});
    });
  }, []);

  const handleToggle = async (agentId, nextEnabled) => {
    setConfigs((prev) => ({
      ...prev,
      [agentId]: { ...(prev[agentId] || {}), enabled: nextEnabled },
    }));
    await fetch(`/api/agent-config?agent=${agentId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ enabled: nextEnabled }),
    }).catch(() => {});
  };

  // Latest run per agent — for now all runs are market-trends
  const latestByAgent = { "market-trends": runs[0] || null };

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Nav */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Scott AI Hub</h1>
            <p className="text-xs text-gray-500 mt-0.5">{AGENTS.length} agent{AGENTS.length !== 1 ? "s" : ""} registered</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {AGENTS.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              latestRun={latestByAgent[agent.id]}
              config={configs[agent.id]}
              onToggle={handleToggle}
            />
          ))}
          <AddAgentCard />
        </div>
      </main>
    </div>
  );
}
