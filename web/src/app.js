import { basicSetup } from "codemirror";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab, selectAll } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

"use strict";

const state = {
  currentAction: "cluster",
  isAdmin: false,
  clusterConfigured: false,
  clusterMembers: null,
  clusterSignature: null,
  scheduledEvents: [],
  patroniInfo: {},
};

const ICONS = {
  cluster: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>',
  history: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 13v2.2l1.6 1"/><path d="M3 12h3.458"/><path d="M3 19h3.832"/><path d="M3 5h18"/><circle cx="16" cy="15" r="6"/></svg>',
  config: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>',
  query: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19h8"/><path d="m4 17 6-6-6-6"/></svg>',
  metrics: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>',
  users: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  unplug: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 5 3-3"/><path d="m2 22 3-3"/><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/><path d="M7.5 13.5 10 11"/><path d="M10.5 16.5 13 14"/><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"/></svg>',
  events: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>',
  reload: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
  restart: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>',
  reinitialize: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>',
  failover: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/></svg>',
  switchover: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/></svg>',
};

const WARNING_ICON = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="#f59e0b" aria-hidden="true"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';
const CHECK_ICON = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="#22c55e" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
const ERROR_ICON = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';

const ACTIONS = [
  { id: "cluster", label: "Dashboard", icon: "cluster", path: "/" },
  { id: "history", label: "Failover History", icon: "history", path: "/history" },
  { id: "config", label: "Configuration", icon: "config", path: "/config" },
  { id: "query", label: "Query", icon: "query", path: "/query" },
];

const ADMIN_ACTIONS = [
  { id: "users", label: "Users", icon: "users", path: "/users" },
  { id: "cluster-config", label: "Cluster Connection", icon: "unplug", path: "/cluster-config" },
];

const NODE_ACTIONS = [
  { id: "reload", label: "Reload", icon: "reload", method: "POST", path: "/reload" },
  { id: "restart", label: "Restart", icon: "restart", method: "POST", path: "/restart" },
  { id: "reinitialize", label: "Reinitialize", icon: "reinitialize", method: "POST", path: "/reinitialize" },
  { id: "failover", label: "Failover", icon: "failover", method: "POST", path: "/failover" },
  { id: "switchover", label: "Switchover", icon: "switchover", method: "POST", path: "/switchover" },
];

const $ = (id) => document.getElementById(id);

// GitHub-style light JSON highlighting.
const githubLight = HighlightStyle.define([
  { tag: t.propertyName, color: "#116329" },
  { tag: t.string, color: "#0a3069" },
  { tag: t.number, color: "#0550ae" },
  { tag: [t.bool, t.null], color: "#cf222e" },
  { tag: t.keyword, color: "#cf222e" },
  { tag: t.punctuation, color: "#24292f" },
  { tag: [t.bracket, t.brace, t.squareBracket, t.paren, t.angleBracket], color: "#24292f" },
  { tag: t.separator, color: "#24292f" },
  { tag: t.operator, color: "#24292f" },
  { tag: t.comment, color: "#6e7781", fontStyle: "italic" },
]);

const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "14px", backgroundColor: "#ffffff" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
  ".cm-gutters": { backgroundColor: "#f8fafc", color: "#94a3b8", border: "none" },
  ".cm-content": { padding: "4px 0" },
  ".cm-line": { padding: "0 8px" },
  ".cm-activeLine": { backgroundColor: "rgba(241, 245, 249, 0.4)" },
  ".cm-activeLineGutter": { backgroundColor: "#e2e8f0" },
  ".cm-selectionBackground": { backgroundColor: "#bfdbfe !important" },
});

const editorExtensions = [
  basicSetup,
  json(),
  Prec.highest(keymap.of([
    indentWithTab,
    { key: "Mod-a", run: selectAll, preventDefault: true },
  ])),
  syntaxHighlighting(githubLight),
  editorTheme,
];

const sqlEditorExtensions = [
  basicSetup,
  sql({ dialect: PostgreSQL }),
  Prec.highest(keymap.of([
    indentWithTab,
    { key: "Mod-Enter", run: () => { runQuery(); return true; } },
    { key: "Mod-a", run: selectAll, preventDefault: true },
  ])),
  syntaxHighlighting(githubLight),
  editorTheme,
];

let configEditor = null;
let sqlEditor = null;
let queryAbort = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function formatBytes(n) {
  if (n === 0) return "0 B";
  const abs = Math.abs(n);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(abs) / Math.log(1024)), units.length - 1);
  if (i <= 0) return `${n} B`;
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatLag(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return formatBytes(v);
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return formatBytes(n);
    return trimmed;
  }
  return String(v);
}

function formatRemaining(schedule) {
  const t = Date.parse(schedule);
  if (Number.isNaN(t)) return "";
  let ms = t - Date.now();
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return `In ${parts.join("")}`;
}

function formatSchedule(schedule) {
  const t = Date.parse(schedule);
  if (Number.isNaN(t)) return schedule;
  const d = new Date(t);
  const base = d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  const offset = mm === 0 ? `${sign}${hh}` : `${sign}${hh}:${String(mm).padStart(2, "0")}`;
  return `${base} ${offset}`;
}

function formatTimeAgo(schedule) {
  const t = Date.parse(schedule);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  if (diff < 0) return "";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo`;
  const yr = Math.floor(mon / 12);
  return `${yr}y`;
}

function stateStyle(state) {
  const s = String(state).toLowerCase();
  if (s === "running" || s === "streaming") return "text-emerald-600 font-medium";
  if (isErrorState(s)) return "text-red-600 font-medium";
  if (s.includes("start") || s.includes("stop") || s.includes("restart")) return "text-amber-600 font-medium";
  return "text-black";
}

function isHealthyState(state) {
  const s = String(state).toLowerCase();
  return s === "running" || s === "streaming";
}

function isErrorState(state) {
  const s = String(state).toLowerCase();
  return s === "stopped" || s === "crashed" || s === "failed" || s === "unknown";
}

function originOf(url) {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return String(url).replace(/\/+$/, "");
  }
}

function extractMembers(data) {
  if (data && typeof data === "object" && Array.isArray(data.members) && data.members.length) {
    return data.members;
  }
  return null;
}

function nodeName(node) {
  return node.name != null ? String(node.name) : "?";
}

function clusterSignature(members) {
  return JSON.stringify(
    [...members].sort((a, b) =>
      String(a.name == null ? "" : a.name).localeCompare(String(b.name == null ? "" : b.name))
    )
  );
}

function clusterStatus(members) {
  if (!members || !members.length) {
    return { level: "degraded", label: "Cluster Degraded" };
  }
  const leader = members.find((m) => ["leader", "primary", "master"].includes(m.role));
  const replicas = members.filter((m) => m !== leader);
  if (!leader || replicas.length === 0) {
    return { level: "degraded", label: "Cluster Degraded" };
  }
  if (members.some((m) => m.pending_restart === true || m.pending_restart === "true")) {
    return { level: "attention", label: "Cluster healthy (action required)" };
  }
  return { level: "healthy", label: "Cluster Healthy" };
}

function clusterAlert(members) {
  return clusterStatus(members).level !== "healthy";
}

function clusterStatusHtml(members) {
  const status = clusterStatus(members);
  const icon = (
    status.level === "healthy" ? CHECK_ICON : status.level === "attention" ? WARNING_ICON : ERROR_ICON
  ).replace("w-4 h-4", "w-5 h-5");
  const textClass =
    status.level === "healthy"
      ? "text-emerald-600"
      : status.level === "attention"
        ? "text-amber-600"
        : "text-red-600";
  return `
    <div class="absolute top-5 left-5 z-10 flex items-center gap-1.5">
      <span class="shrink-0">${icon}</span>
      <span class="${textClass} text-lg font-semibold">${escapeHtml(status.label)}</span>
    </div>
  `;
}

function updateClusterAlert(members) {
  const el = $("cluster-alert");
  if (!el) return;
  el.classList.toggle("hidden", !clusterAlert(members));
}

const FAVICON_COLORS = {
  healthy: "#22c55e",
  attention: "#f59e0b",
  degraded: "#ef4444",
  none: "#94a3b8",
};

function setFavicon(color) {
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}"/></svg>`;
  link.href = "data:image/svg+xml," + encodeURIComponent(svg);
}

function updateFavicon(members) {
  let color;
  if (!state.clusterConfigured) {
    color = FAVICON_COLORS.none;
  } else if (members && members.length) {
    const level = clusterStatus(members).level;
    color = FAVICON_COLORS[level] || FAVICON_COLORS.degraded;
  } else {
    color = FAVICON_COLORS.degraded;
  }
  setFavicon(color);
}

function showStatus(msg, cls) {
  $("status").innerHTML = `<span class="${cls || "text-slate-300"}">${escapeHtml(msg)}</span>`;
}

async function apiCall(method, path, body, baseUrl) {
  const payload = { method, path };
  if (body !== undefined) payload.body = body;
  if (baseUrl) payload.base_url = baseUrl;
  const res = await fetch("/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// ---- cluster tree (Cluster Status) ----

function orderedMembers(members) {
  const leader =
    members.find((m) => ["leader", "primary", "master"].includes(m.role)) || members[0];
  const replicas = members.filter((m) => m !== leader);
  return [leader, ...replicas];
}

function renderClusterTree(members, container, scope) {
  const ordered = orderedMembers(members);
  const replicas = ordered.slice(1);
  state.clusterMembers = ordered;
  state.clusterSignature = clusterSignature(members);

  let html = clusterStatusHtml(members);
  html += '<div class="visual relative w-full my-auto">';
  html += '<div class="flex flex-col items-center px-6 py-6">';
  if (scope) {
    html += `<div class="mb-6 text-lg font-medium text-black">${escapeHtml(scope)}</div>`;
  }
  html += nodeBlock(ordered[0], true, "visual-leader", 0);
  html += '<div class="h-20 w-full"></div>';
  if (replicas.length) {
    html += '<div id="visual-replicas" class="flex flex-wrap justify-center gap-8">';
    for (let i = 0; i < replicas.length; i++) {
      html += nodeBlock(replicas[i], false, "", i + 1);
    }
    html += "</div>";
  } else {
    html += '<div class="text-sm text-slate-600">No replicas</div>';
  }
  html += "</div>";
  html += '<svg id="visual-lines" class="absolute inset-0 w-full h-full pointer-events-none"></svg>';
  html += "</div>";
  container.innerHTML = html;

  container.querySelectorAll("[data-node-index]").forEach((block) => {
    const index = Number(block.dataset.nodeIndex);
    const member = state.clusterMembers[index];
    const card = block.querySelector(".node-card");
    if (!card) return;
    card.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const actionId = btn.dataset.act;
        if (actionId === "restart") {
          showRestartForm(member);
        } else if (actionId === "switchover") {
          showPromoteForm(member);
        } else {
          confirmNodeAction(member, actionId);
        }
      });
    });
    if (member.pending_restart === true || member.pending_restart === "true") {
      const reason = member.pending_restart_reason;
      const reasonText =
        reason !== null && reason !== undefined
          ? typeof reason === "string"
            ? reason
            : JSON.stringify(reason, null, 2)
          : "";
      card.title = "Restart required" + (reasonText ? "\n" + reasonText : "");
    }
  });

  drawConnectors();
}

function drawConnectors() {
  const leaderEl = document.getElementById("visual-leader");
  const replicaCards = [...document.querySelectorAll("#visual-replicas .node-card")];
  const svg = document.getElementById("visual-lines");
  const leaderCard = leaderEl ? leaderEl.querySelector(".node-card") : null;
  if (!leaderCard || !svg) return;

  const leaderRect = leaderCard.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  if (svgRect.width === 0 || svgRect.height === 0) return;

  const defs =
    '<defs><linearGradient id="connGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#10b981"></stop>' +
    '<stop offset="1" stop-color="#6ee7b7"></stop>' +
    '</linearGradient></defs>';

  // Small gap so the stroke doesn't overlap the card borders.
  const gap = 4;
  const y1 = leaderRect.bottom - svgRect.top + gap;

  // Sort all replicas left-to-right and reserve an exit slot for each, so line
  // positions stay stable when a node goes offline.
  const all = [...replicaCards].sort(
    (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
  );
  if (!all.length) {
    svg.innerHTML = defs;
    return;
  }

  const n = all.length;
  const margin = 0.2;
  const originFor = (i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const frac = margin + t * (1 - 2 * margin);
    return leaderRect.left - svgRect.left + leaderRect.width * frac;
  };

  // Online replicas with their exit point, center and top.
  const online = [];
  all.forEach((card, i) => {
    const block = card.closest("[data-node-index]");
    const member = block ? state.clusterMembers[Number(block.dataset.nodeIndex)] : null;
    if (member && isErrorState(member.state)) return;
    const rect = card.getBoundingClientRect();
    online.push({
      x1: originFor(i),
      x2: rect.left - svgRect.left + rect.width / 2,
      y2: rect.top - svgRect.top - gap,
    });
  });

  if (!online.length) {
    svg.innerHTML = defs;
    return;
  }

  // Two (or fewer) replicas get simple straight lines; three or more get a
  // gentle S-curve so the fan-out doesn't look cluttered.
  const useWave = online.length > 2;
  let connD = "";
  for (const o of online) {
    if (useWave) {
      const k = Math.max(24, (o.y2 - y1) * 0.75);
      connD += `M ${o.x1} ${y1} C ${o.x1} ${y1 + k}, ${o.x2} ${o.y2 - k}, ${o.x2} ${o.y2} `;
    } else {
      connD += `M ${o.x1} ${y1} L ${o.x2} ${o.y2} `;
    }
  }

  svg.innerHTML =
    defs +
    `<path class="conn" d="${connD}"></path>` +
    `<path class="conn-flow" d="${connD}"></path>`;
}

function nodeFooterActions(isLeader) {
  const actions = [
    { id: "reload", label: "Reload" },
    { id: "restart", label: "Restart" },
  ];
  if (!isLeader) {
    actions.push({ id: "reinitialize", label: "Reinitialize" });
    actions.push({ id: "switchover", label: "Promote" });
  }
  return actions;
}

function nodeBlock(member, isLeader, id, index) {
  const role = isLeader ? "leader" : member.role != null ? String(member.role) : "replica";
  const error = isErrorState(member.state);
  const healthy = isHealthyState(member.state);
  const border = error
    ? (isLeader ? "border-red-600" : "border-red-400")
    : isLeader || healthy
      ? (isLeader ? "border-emerald-500" : "border-emerald-400")
      : "border-slate-200";
  const bg = error
    ? (isLeader ? "bg-red-400" : "bg-red-50")
    : healthy
      ? (isLeader ? "bg-emerald-100" : "bg-emerald-50")
      : (isLeader ? "bg-slate-400" : "bg-white");
  const badgeClass = isLeader ? "bg-emerald-500 text-white" : "bg-blue-500 text-white";
  const footerHtml = state.isAdmin
    ? `<div class="mt-1 grid grid-cols-2 gap-1 border-t border-emerald-300 pt-2">${nodeFooterActions(isLeader)
        .map(
          (a) =>
            `<button data-act="${a.id}" class="px-1 py-1 rounded text-[12px] font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 cursor-pointer">${a.label}</button>`
        )
        .join("")}</div>`
    : "";
  return `
    <div ${id ? `id="${id}"` : ""} data-node-index="${index}" class="relative flex flex-col items-center">
      <div class="node-card ${bg} border ${border} rounded-lg shadow-sm px-4 py-3 w-52 min-w-[250px] hover:shadow-md transition-shadow">
        ${cardBody(member, isLeader)}
        ${footerHtml}
      </div>
      <span class="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide shadow-sm ${badgeClass}">${escapeHtml(role)}</span>
    </div>
  `;
}

function cardBody(member, isLeader) {
  const name = member.name != null ? String(member.name) : "?";
  const host = member.host != null ? String(member.host) : "";
  const port = member.port != null ? String(member.port) : "";
  const hostPort = host ? (port !== "" ? `${host}:${port}` : host) : "";
  const stateText = member.state != null ? String(member.state) : "unknown";
  const pending = member.pending_restart === true || member.pending_restart === "true";

  const pendingBadge = pending
    ? '<span class="ml-auto shrink-0 inline-flex items-center"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="#f59e0b" aria-hidden="true"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg></span>'
    : "";

  const txt = isLeader
			? { name: "text-slate-800", host: "text-slate-500", label: "text-black", meta: "text-black", metaBorder: "border-gray-100" }
			: { name: "text-slate-800", host: "text-slate-500", label: "text-black", meta: "text-black", metaBorder: "border-gray-100" };

  let lagHtml = "";
  if (!isLeader) {
    const rows = [];
    const addLag = (label, v) => {
      const f = formatLag(v);
      if (f !== null) {
        rows.push(`<tr><td class="pr-2 text-black/70">${label}</td><td class="text-right">${escapeHtml(f)}</td></tr>`);
      }
    };
    addLag("Lag", member.lag);
    addLag("Receive", member.receive_lag);
    addLag("Replay", member.replay_lag);
    if (rows.length) {
      lagHtml = `<table class="mt-1.5 w-full text-[13px] font-mono text-black/70"><tbody>${rows.join("")}</tbody></table>`;
    }
  }

  const stateValueClass = stateStyle(stateText);

  return `
    <div class="flex items-center gap-1.5">
      <span class="font-semibold text-sm ${txt.name} truncate">${escapeHtml(name)}</span>
      ${pendingBadge}
    </div>
    ${hostPort ? `<div class="mt-0.5 text-[13px] font-mono ${txt.host} truncate">${escapeHtml(hostPort)}</div>` : ""}
    <div class="mt-1 text-[13px]">
      <div class="flex justify-between"><span class="${txt.label}">state</span> <span class="${stateValueClass}">${escapeHtml(stateText)}</span></div>
      <div data-node-replication class="flex justify-between text-[13px] ${txt.host}"><span class="${txt.label}">replication</span><span class="${isLeader ? "text-slate-300" : "text-slate-300"}">…</span></div>
    </div>
    ${lagHtml}
    <div data-node-meta class="mt-1 _border-t ${txt.metaBorder} pt-1.5 text-[12px] ${txt.meta} text-black/70 text-center">PostgreSQL · Patroni</div>
	`;
}

// ---- history table (Failover History) ----

function renderHistoryTable(entries, container) {
  const headers = ["TL", "LSN", "Reason", "Timestamp", "Leader"];
  const rows = [...entries].sort((a, b) => (Number(b[0]) || 0) - (Number(a[0]) || 0));

  let html = '<table class="w-full border-separate border-spacing-0">';
  html += '<thead><tr>';
  for (const h of headers) {
    html += `<th class="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">${h}</th>`;
  }
  html += "</tr></thead><tbody class=\"divide-y divide-slate-100\">";
  for (const row of rows) {
    html += '<tr class="odd:bg-white even:bg-slate-50 hover:bg-slate-100">';
    for (let i = 0; i < headers.length; i++) {
      const v = row[i];
      let cell;
      if (v === null || v === undefined || v === "") {
        cell = '<span class="text-slate-300">—</span>';
      } else if (i === 3) {
        cell = `${escapeHtml(formatSchedule(v))} <span class="text-xs text-slate-400">(${escapeHtml(formatTimeAgo(v))})</span>`;
      } else {
        cell = escapeHtml(String(v));
      }
      html += `<td class="px-3 py-1.5 text-sm text-slate-700 align-middle">${cell}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  container.innerHTML = html;
}

// ---- scheduled events ----

function buildScheduledEvents(data) {
  const events = [];
  if (data && data.scheduled_switchover && data.scheduled_switchover.at) {
    const sw = data.scheduled_switchover;
    events.push({
      type: "Switchover",
      target: `${sw.from || "?"} ⇄ ${sw.to || "?"}`,
      schedule: sw.at || "",
      path: "/switchover",
      member: null,
    });
  }
  if (data && Array.isArray(data.members)) {
    for (const m of data.members) {
      if (m.scheduled_restart && m.scheduled_restart.schedule) {
        events.push({
          type: "Restart",
          target: m.name != null ? String(m.name) : "?",
          schedule: String(m.scheduled_restart.schedule),
          path: "/restart",
          member: m,
        });
      }
    }
  }
  return events;
}

function renderScheduledEvents(data, container) {
  const events = buildScheduledEvents(data);
  state.scheduledEvents = events;
  if (!events.length) {
    container.innerHTML = '<div class="text-sm text-slate-400">No scheduled events.</div>';
    return;
  }
  container.innerHTML = events
    .map(
      (ev, i) => `
      <div class="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(ev.type)}</span>
          <span class="shrink-0 text-xs text-slate-500">(${escapeHtml(formatRemaining(ev.schedule))})</span>
        </div>
        <div class="mt-1 text-sm text-slate-700 break-words">${escapeHtml(ev.target)}</div>
        <div class="mt-0.5 text-xs text-slate-500 truncate">${escapeHtml(formatSchedule(ev.schedule))}</div>
        <div class="mt-2 flex items-center justify-end">
          <button data-cancel="${i}" class="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200">Cancel</button>
        </div>
      </div>`
    )
    .join("");
  container.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => confirmCancelScheduledEvent(Number(btn.dataset.cancel)));
  });
}

async function cancelScheduledEvent(index) {
  const ev = state.scheduledEvents[index];
  if (!ev) return;
  const baseUrl = ev.member ? originOf(ev.member.api_url) : "";
  const result = await apiCall("DELETE", ev.path, undefined, baseUrl);
  if (result.error || result.status_code >= 400) {
    showStatus(result.error || "Cancel failed", "text-red-400");
  } else {
    showStatus("Cancelled", "text-emerald-300");
  }
  loadScheduledEvents();
}

function confirmCancelScheduledEvent(index) {
  const ev = state.scheduledEvents[index];
  if (!ev) return;
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-1">Cancel ${ev.type}?</div>
    <div class="text-sm text-slate-600 mb-4">This will cancel the scheduled ${ev.type.toLowerCase()} for ${escapeHtml(ev.target)}.</div>
    <div class="flex items-center justify-end gap-2">
      <button data-no class="px-4 py-2 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold">Cancel</button>
      <button data-yes class="px-4 py-2 rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold">Yes</button>
    </div>
  `;
  showModal();
  $("modal").querySelector("[data-yes]").addEventListener("click", () => {
    closeModal();
    cancelScheduledEvent(index);
  });
  $("modal").querySelector("[data-no]").addEventListener("click", closeModal);
}

// ---- node actions ----

function actionSpec(id) {
  return NODE_ACTIONS.find((a) => a.id === id);
}

function actionBody(id, node) {
  switch (id) {
    case "failover":
      return { candidate: node.name };
    case "switchover":
      return { leader: currentLeaderName(), candidate: node.name };
    case "restart":
      return {};
    case "reinitialize":
      return { force: true };
    default:
      return null;
  }
}

function currentLeaderName() {
  const leader = state.clusterMembers && state.clusterMembers[0];
  return leader && leader.name != null ? String(leader.name) : "";
}

function showModal(width) {
  const modal = $("modal");
  modal.classList.remove("max-w-sm", "max-w-md", "max-w-lg", "max-w-xl");
  modal.classList.add(width || "max-w-sm");
  $("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  $("modal-overlay").classList.add("hidden");
}

// patroniCardInfo renders the useful /patroni metadata for a node card
// (PostgreSQL and Patroni versions) as plain text.
function patroniCardInfo(meta) {
  if (!meta) return "";
  const parts = [];
  const pg = formatServerVersion(meta.server_version);
  if (pg) parts.push(`PostgreSQL ${pg}`);
  const pv = meta.patroni && meta.patroni.version;
  if (pv) parts.push(`Patroni ${pv}`);
  if (!parts.length) return "";
  return parts.join(" · ");
}

function applyPatroniCard(index, meta) {
  if (!meta) return;
  const text = patroniCardInfo(meta);
  if (!text) return;
  const block = document.querySelector(`[data-node-index="${index}"]`);
  const el = block && block.querySelector("[data-node-meta]");
  if (el) el.textContent = text;
}

// loadNodePatroni fetches /patroni for every cluster node once and caches the
// result, then enriches the matching card with its metadata.
async function loadNodePatroni() {
  const members = state.clusterMembers;
  if (!members || !members.length) return;
  await Promise.all(
    members.map(async (member, i) => {
      const name = member.name != null ? String(member.name) : "";
      if (!Object.prototype.hasOwnProperty.call(state.patroniInfo, name)) {
        state.patroniInfo[name] = await fetchNodeMeta(member);
      }
      applyPatroniCard(i, state.patroniInfo[name]);
    })
  );
  drawConnectors();
}

// applyPatroniInfo re-applies the cached /patroni metadata to the (re-rendered)
// cards without issuing new requests.
function applyPatroniInfo() {
  const members = state.clusterMembers;
  if (!members || !members.length) return;
  members.forEach((member, i) => {
    const name = member.name != null ? String(member.name) : "";
    applyPatroniCard(i, state.patroniInfo[name]);
  });
}

function replicationModeHtml(isSync, light) {
  const mode = isSync ? "sync" : "async";
  const labelCls = light ? "text-black" : "text-black";
  const valueCls = light
    ? (isSync ? "text-emerald-600" : "text-amber-600")
    : (isSync ? "text-emerald-600" : "text-amber-600");
  return `<span class="${labelCls}">replication</span> <span class="${valueCls} font-semibold">${mode}</span>`;
}

// loadNodeSync queries GET /synchronous for every node and updates the card's
// replication mode (sync when the endpoint answers 200, async otherwise).
async function loadNodeSync() {
  const members = state.clusterMembers;
  if (!members || !members.length) return;
  await Promise.all(
    members.map(async (member, i) => {
      const baseUrl = originOf(member.api_url != null ? String(member.api_url) : "");
      if (!baseUrl) return;
      const result = await apiCall("GET", "/synchronous", undefined, baseUrl);
      const isSync = result.status_code >= 200 && result.status_code < 300;
      const block = document.querySelector(`[data-node-index="${i}"]`);
      const el = block && block.querySelector("[data-node-replication]");
      if (el) el.innerHTML = replicationModeHtml(isSync, i === 0);
    })
  );
  drawConnectors();
}

async function fetchNodeMeta(node) {
  const baseUrl = originOf(node.api_url != null ? String(node.api_url) : "");
  if (!baseUrl) return null;
  const result = await apiCall("GET", "/patroni", undefined, baseUrl);
  if (result.error || result.status_code >= 400) return null;
  return result.data;
}

function formatServerVersion(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  const major = Math.floor(n / 10000);
  const minor = n % 10000;
  return `${major}.${minor}`;
}

function confirmNodeAction(node, actionId) {
  const spec = actionSpec(actionId);
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-1">${spec.label} ${escapeHtml(nodeName(node))}?</div>
    <div class="text-sm text-slate-600 mb-4">This will run ${spec.label.toLowerCase()} on this node.</div>
    <div class="flex items-center justify-end gap-2">
      <button data-no class="px-4 py-2 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold">Cancel</button>
      <button data-yes class="px-4 py-2 rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold">Yes</button>
    </div>
  `;
  showModal();
  $("modal").querySelector("[data-yes]").addEventListener("click", () => {
    if (actionId === "reload") {
      runNodeAction(node, actionId);
    } else {
      showBodyEditor(node, actionId);
    }
  });
  $("modal").querySelector("[data-no]").addEventListener("click", closeModal);
}

function showRestartForm(node) {
  const scheduleDefault = isoOneHourAhead();
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-1">Restart ${escapeHtml(nodeName(node))}</div>
    <div class="text-sm text-slate-500 mb-3">Restart conditions (all optional)</div>
    <div id="restart-error" class="hidden mb-2 text-sm text-red-600"></div>
    <div class="space-y-4">
      <div>
        <label for="restart-pending" class="flex items-start gap-2.5 cursor-pointer select-none">
          <input id="restart-pending" type="checkbox" class="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-brand focus:ring-brand" />
          <span class="text-sm text-slate-700">Restart only if required <span class="text-slate-400">(optional)</span></span>
        </label>
        <p class="mt-1 pl-7 text-xs text-slate-500">Restart PostgreSQL only when a restart is pending in order to apply config changes.</p>
      </div>
      <div>
        <label for="restart-timeout" class="block text-sm font-medium text-slate-700 mb-1">Timeout <span class="font-normal text-slate-400">(optional)</span></label>
        <input id="restart-timeout" type="text" placeholder="e.g. 30s" class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <p class="mt-1 text-xs text-slate-500">How long to wait before PostgreSQL starts accepting connections (overrides primary_start_timeout).</p>
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700 mb-1">When</label>
        <div class="space-y-2">
          <label class="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="radio" name="restart-when" value="now" checked class="mt-0.5 h-4 w-4 shrink-0 border-slate-300 text-brand focus:ring-brand" />
            <span class="text-sm text-slate-700">Restart now</span>
          </label>
          <label class="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="radio" name="restart-when" value="schedule" class="mt-0.5 h-4 w-4 shrink-0 border-slate-300 text-brand focus:ring-brand" />
            <span class="text-sm text-slate-700">Schedule</span>
          </label>
        </div>
      </div>
      <div id="restart-schedule-wrap" class="hidden">
        <label for="restart-schedule" class="block text-sm font-medium text-slate-700 mb-1">Schedule <span class="font-normal text-slate-400">(optional)</span></label>
        <input id="restart-schedule" type="text" value="${escapeHtml(scheduleDefault)}" required class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <p class="mt-1 text-xs text-slate-500">Timestamp with time zone — schedule the restart in the future.</p>
      </div>
    </div>
    <div class="flex items-center justify-end gap-2 mt-4">
      <button data-cancel class="px-4 py-2 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold">Cancel</button>
      <button data-send class="px-4 py-2 rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold">Restart</button>
    </div>
  `;
  showModal();
  const scheduleWrap = $("restart-schedule-wrap");
  document.querySelectorAll('input[name="restart-when"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      scheduleWrap.classList.toggle("hidden", radio.value !== "schedule");
    });
  });
  $("modal").querySelector("[data-send]").addEventListener("click", () => {
    const body = {};
    if ($("restart-pending").checked) body.restart_pending = true;
    const timeout = $("restart-timeout").value.trim();
    if (timeout) body.timeout = timeout;
    const when = document.querySelector('input[name="restart-when"]:checked').value;
    const err = $("restart-error");
    if (when === "schedule") {
      const schedule = $("restart-schedule").value.trim();
      if (!schedule) {
        err.textContent = "Schedule is required when Schedule mode is selected.";
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      body.schedule = schedule;
    }
    runNodeAction(node, "restart", body);
  });
  $("modal").querySelector("[data-cancel]").addEventListener("click", closeModal);
}

function showPromoteForm(node) {
  const scheduleDefault = isoOneHourAhead();
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-1">Promote ${escapeHtml(nodeName(node))}</div>
    <div class="text-sm text-slate-500 mb-3">Promote this replica to leader</div>
    <div id="promote-error" class="hidden mb-2 text-sm text-red-600"></div>
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-slate-700 mb-1">When</label>
        <div class="space-y-2">
          <label class="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="radio" name="promote-when" value="now" checked class="mt-0.5 h-4 w-4 shrink-0 border-slate-300 accent-brand focus:ring-brand" />
            <span class="text-sm text-slate-700">Promote now</span>
          </label>
          <label class="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="radio" name="promote-when" value="schedule" class="mt-0.5 h-4 w-4 shrink-0 border-slate-300 accent-brand focus:ring-brand" />
            <span class="text-sm text-slate-700">Schedule</span>
          </label>
        </div>
      </div>
      <div id="promote-schedule-wrap" class="hidden">
        <label for="promote-schedule" class="block text-sm font-medium text-slate-700 mb-1">Schedule</label>
        <input id="promote-schedule" type="text" value="${escapeHtml(scheduleDefault)}" required class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <p class="mt-1 text-xs text-slate-500">Timestamp with time zone — schedule the promotion in the future.</p>
      </div>
    </div>
    <div class="flex items-center justify-end gap-2 mt-4">
      <button data-cancel class="px-4 py-2 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold">Cancel</button>
      <button data-send class="px-4 py-2 rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold">Promote</button>
    </div>
  `;
  showModal();
  const scheduleWrap = $("promote-schedule-wrap");
  document.querySelectorAll('input[name="promote-when"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      scheduleWrap.classList.toggle("hidden", radio.value !== "schedule");
    });
  });
  $("modal").querySelector("[data-send]").addEventListener("click", () => {
    const body = {
      leader: currentLeaderName(),
      candidate: node.name,
    };
    const when = document.querySelector('input[name="promote-when"]:checked').value;
    const err = $("promote-error");
    if (when === "schedule") {
      const schedule = $("promote-schedule").value.trim();
      if (!schedule) {
        err.textContent = "Schedule is required when Schedule mode is selected.";
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      body.scheduled_at = schedule;
    }
    runNodeAction(node, "switchover", body);
  });
  $("modal").querySelector("[data-cancel]").addEventListener("click", closeModal);
}

function isoOneHourAhead() {
  const d = new Date(Date.now() + 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
}

function showBodyEditor(node, actionId) {
  const spec = actionSpec(actionId);
  const body = actionBody(actionId, node);
  const bodyJson = body == null ? "" : JSON.stringify(body, null, 2);
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-1">${spec.label} ${escapeHtml(nodeName(node))}</div>
    <div class="text-sm text-slate-600 mb-2">Request body (JSON)</div>
    <div id="node-body-error" class="hidden mb-2 text-sm text-red-600"></div>
    <textarea id="node-body" rows="7" spellcheck="false" class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500">${escapeHtml(bodyJson)}</textarea>
    <div class="flex items-center justify-end gap-2 mt-3">
      <button data-cancel class="px-4 py-2 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold">Cancel</button>
      <button data-send class="px-4 py-2 rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold">Execute</button>
    </div>
  `;
  showModal();
  $("modal").querySelector("[data-send]").addEventListener("click", () => {
    const text = $("node-body").value.trim();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (e) {
        const err = $("node-body-error");
        err.textContent = "Invalid JSON: " + e.message;
        err.classList.remove("hidden");
        return;
      }
    }
    runNodeAction(node, actionId, body);
  });
  $("modal").querySelector("[data-cancel]").addEventListener("click", closeModal);
}

async function runNodeAction(node, actionId, body) {
  const spec = actionSpec(actionId);
  $("modal").innerHTML = `<div class="text-sm text-slate-500 py-6 text-center">Running ${spec.label.toLowerCase()}…</div>`;
  const result = await executeNodeAction(node, actionId, body);
  showNodeActionResult(node, spec, result);
}

function showNodeActionResult(node, spec, result) {
  const ok = result.status_code >= 200 && result.status_code < 300;
  const statusText = result.status_code || "ERR";
  const detail = result.raw || result.error || "";
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-2">${spec.label} ${escapeHtml(nodeName(node))}</div>
    <div class="text-lg font-bold ${ok ? "text-emerald-600" : "text-red-600"} mb-1">${statusText}</div>
    ${detail ? `<div class="text-xs text-slate-500 font-mono break-all max-h-40 overflow-auto mb-3">${escapeHtml(detail)}</div>` : ""}
    <button data-close class="w-full px-3 py-2 rounded bg-slate-200 hover:bg-slate-300 text-sm font-medium">Close</button>
  `;
  $("modal").querySelector("[data-close]").addEventListener("click", closeModal);
}

async function executeNodeAction(node, actionId, body) {
  const spec = actionSpec(actionId);
  const baseUrl = originOf(node.api_url != null ? String(node.api_url) : "");
  if (!baseUrl) {
    return { status_code: 0, raw: "", error: "No API URL for this node", headers: {}, data: null };
  }
  const payload = {
    base_url: baseUrl,
    method: spec.method,
    path: spec.path,
    body: body !== undefined ? body : actionBody(actionId, node),
  };
  const res = await fetch("/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// ---- action views ----

function actionForPath(pathname) {
  const a =
    ACTIONS.find((a) => a.path === pathname) ||
    ADMIN_ACTIONS.find((a) => a.path === pathname);
  return a ? a.id : "cluster";
}

function pathForAction(actionId) {
  const a =
    ACTIONS.find((a) => a.id === actionId) ||
    ADMIN_ACTIONS.find((a) => a.id === actionId);
  return a ? a.path : "/";
}

function actionButtonClass(actionId) {
  const active = state.currentAction === actionId;
  return (
    "w-full text-left flex items-center gap-2 px-3 py-2.5 rounded text-sm font-medium " +
    (active ? "bg-slate-200 text-slate-900" : "hover:bg-slate-100 text-slate-700")
  );
}

function renderActionsNav() {
  const nav = $("actions-nav");
  nav.innerHTML = ACTIONS.map((a) => {
    const alert = a.id === "cluster" ? `<span id="cluster-alert" class="hidden shrink-0 ml-auto">${WARNING_ICON}</span>` : "";
    return `
    <button data-action="${a.id}" class="${actionButtonClass(a.id)}">
      <span class="shrink-0">${ICONS[a.icon]}</span>
      <span>${a.label}</span>
      ${alert}
    </button>`;
  }).join("");
}

function renderAdminNav() {
  const nav = $("admin-nav");
  if (!nav) return;
  nav.innerHTML = ADMIN_ACTIONS.map((a) => `
    <button data-action="${a.id}" class="${actionButtonClass(a.id)}">
      <span class="shrink-0">${ICONS[a.icon]}</span>
      <span>${a.label}</span>
    </button>`).join("");
}

function switchAction(actionId) {
  state.currentAction = actionId;
  if (configEditor) {
    configEditor.destroy();
    configEditor = null;
  }
  if (sqlEditor) {
    sqlEditor.destroy();
    sqlEditor = null;
  }
  if (queryAbort) {
    queryAbort.abort();
    queryAbort = null;
  }
  document.querySelectorAll("#actions-nav [data-action], #admin-nav [data-action]").forEach((btn) => {
    btn.className = actionButtonClass(btn.dataset.action);
  });
  renderAction();
}

function renderAction() {
  if (
    !state.clusterConfigured &&
    state.currentAction !== "cluster-config" &&
    state.currentAction !== "users"
  ) {
    showNoClusterAction();
    return;
  }
  switch (state.currentAction) {
    case "cluster":
      showClusterAction();
      break;
    case "history":
      showHistoryAction();
      break;
    case "config":
      showConfigAction();
      break;
    case "query":
      showQueryAction();
      break;
    case "users":
      showUsersAction();
      break;
    case "cluster-config":
      showClusterConfigAction();
      break;
  }
}

function showClusterAction() {
  $("main-content").innerHTML =
    '<div id="cluster-tree" class="relative flex-1 min-h-0 overflow-auto bg-white rounded-lg shadow flex flex-col"></div>';
  loadClusterStatus();
}

async function loadClusterStatus() {
  const result = await apiCall("GET", "/cluster");
  const container = $("cluster-tree");
  if (!container) return;
  if (result.error || result.status_code >= 400) {
    container.innerHTML = `<div class="p-6 text-sm text-red-600">${escapeHtml(result.error || "Failed to load cluster")}</div>`;
    updateFavicon(null);
    return;
  }
  const members = extractMembers(result.data);
  const scope = result.data && result.data.scope != null ? String(result.data.scope) : "";
  if (!members || !members.length) {
    container.innerHTML =
      clusterStatusHtml(null) +
      '<div class="my-auto px-6 py-6 text-sm text-slate-400 text-center">No cluster data.</div>';
    updateClusterAlert(null);
    updateFavicon(null);
    return;
  }

  // Keep the graph hidden until every /patroni request has finished, so the
  // cards appear already enriched with the real PostgreSQL/Patroni versions.
  // Show the loading indicator only after a 200ms debounce so fast loads don't
  // flash it.
  const loadingTimer = setTimeout(() => {
    container.innerHTML =
      '<div class="my-auto px-6 py-6 text-sm text-slate-400 text-center">Loading cluster…</div>';
  }, 200);

  state.clusterMembers = orderedMembers(members);
  await loadNodePatroni();
  clearTimeout(loadingTimer);

  renderClusterTree(members, container, scope);
  updateClusterAlert(members);
  updateFavicon(members);
  applyPatroniInfo();
  loadNodeSync();
}

function showHistoryAction() {
  $("main-content").innerHTML = `
    <div class="flex-1 min-h-0 flex flex-col bg-white rounded-lg shadow p-4 gap-3">
      <div class="text-lg font-semibold text-slate-800 py-1">Failover History</div>
      <div id="history-table" class="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-lg nice-scrollbar"></div>
    </div>
  `;
  loadHistory();
}

async function loadHistory() {
  const result = await apiCall("GET", "/history");
  const container = $("history-table");
  if (!container) return;
  if (result.error || result.status_code >= 400) {
    container.innerHTML = `<div class="p-6 text-sm text-red-600">${escapeHtml(result.error || "Failed to load history")}</div>`;
    return;
  }
  renderHistoryTable(Array.isArray(result.data) ? result.data : [], container);
}

function showConfigAction() {
  const isAdmin = state.isAdmin;
  $("main-content").innerHTML = `
    <div class="flex-1 min-h-0 flex flex-col bg-white rounded-lg shadow p-4 gap-3">
      <div class="flex items-center justify-between gap-3">
        <div class="text-lg font-semibold text-slate-800">Dynamic Configuration</div>
        ${
          isAdmin
            ? `<div class="flex items-center gap-3">
          <span id="config-status" class="text-sm text-slate-500"></span>
          <button id="save-config" class="rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold px-4 py-2">Save</button>
        </div>`
            : ""
        }
      </div>
      <div id="config-editor" class="flex-1 min-h-0 rounded border border-gray-200 overflow-hidden"></div>
    </div>
  `;
  const extensions = isAdmin
    ? editorExtensions
    : [...editorExtensions, EditorView.editable.of(false)];
  configEditor = new EditorView({
    parent: $("config-editor"),
    state: EditorState.create({ doc: "", extensions }),
  });
  if (isAdmin) {
    $("save-config").addEventListener("click", saveConfig);
  }
  loadConfig();
}

async function loadConfig() {
  const result = await apiCall("GET", "/config");
  if (!configEditor) return;
  if (result.error || result.status_code >= 400) {
    configEditor.dispatch({ changes: { from: 0, to: configEditor.state.doc.length, insert: "Failed to load configuration" } });
    return;
  }
  const text = JSON.stringify(result.data, null, 2);
  configEditor.dispatch({ changes: { from: 0, to: configEditor.state.doc.length, insert: text } });
}

function configErrorMessage(result) {
  const status = result.status_code;
  let text = result.error;
  if (!text) {
    const raw = result.raw != null ? String(result.raw).trim() : "";
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        const msg = obj && (obj.error || obj.message || obj.detail || obj.reason);
        text = typeof msg === "string" && msg.trim() ? msg.trim() : raw;
      } catch {
        text = raw;
      }
      if (text.length > 300) text = text.slice(0, 300) + "…";
    }
  }
  if (status) {
    return text ? status + " " + text : status + " error";
  }
  return text || "error";
}

async function saveConfig() {
  if (!configEditor) return;
  const text = configEditor.state.doc.toString().trim();
  let config;
  try {
    config = JSON.parse(text);
  } catch (e) {
    $("config-status").textContent = "Invalid JSON: " + e.message;
    $("config-status").className = "text-sm text-red-600";
    return;
  }
  $("config-status").textContent = "Saving…";
  $("config-status").className = "text-sm text-slate-500";

  let result;
  try {
    result = await apiCall("PUT", "/config", config);
  } catch (e) {
    $("config-status").textContent = "Could not reach the server: " + (e && e.message ? e.message : e);
    $("config-status").className = "text-sm text-red-600";
    return;
  }

  if (result.error || result.status_code >= 400) {
    $("config-status").textContent = configErrorMessage(result);
    $("config-status").className = "text-sm text-red-600";
    return;
  }
  $("config-status").textContent = "Saved";
  $("config-status").className = "text-sm text-emerald-600";
}

// ---- query ----

function showQueryAction() {
  $("main-content").innerHTML = `
    <div class="flex-1 min-h-0 flex flex-col bg-white rounded-lg shadow p-4 gap-3">
      <div class="flex items-center justify-between gap-3">
        <div class="text-lg font-semibold text-slate-800">Query</div>
        <button id="query-run" class="rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold px-4 py-2">Execute</button>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <label for="query-target" class="text-sm text-slate-600">Target</label>
          <select id="query-target" class="rounded border border-slate-300 px-2 py-1.5 text-sm bg-white"></select>
        </div>
        <div class="flex items-center gap-2">
          <label for="query-limit" class="text-sm text-slate-600">Limit</label>
          <input id="query-limit" type="number" value="100" min="1" max="10000" class="w-20 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
      </div>
      <div id="query-editor" class="h-40 rounded border border-gray-200 overflow-hidden"></div>
      <div id="query-result" class="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-lg nice-scrollbar"></div>
      <div id="query-meta" class="shrink-0"></div>
    </div>
  `;
  $("query-run").addEventListener("click", runQuery);
  sqlEditor = new EditorView({
    parent: $("query-editor"),
    state: EditorState.create({ doc: "", extensions: sqlEditorExtensions }),
  });
  loadQueryNodes();
}

async function loadQueryNodes() {
  const select = $("query-target");
  if (!select) return;
  const result = await apiCall("GET", "/cluster");
  let options = '<option value="leader">Leader</option><option value="replica">Replica</option>';
  if (!result.error && result.status_code < 400) {
    const members = extractMembers(result.data);
    if (members) {
      for (const m of members) {
        const name = m.name != null ? String(m.name) : "?";
        options += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
      }
    }
  }
  select.innerHTML = options;
}

async function runQuery() {
  const select = $("query-target");
  const resultEl = $("query-result");
  if (!select || !resultEl || !sqlEditor) return;

  const sql = sqlEditor.state.doc.toString().trim();
  if (!sql) return;

  const limit = Number($("query-limit").value) || 100;
  const targetValue = select.value;

  const payload = { sql, limit };
  if (targetValue === "leader" || targetValue === "replica") {
    payload.target = targetValue;
  } else {
    payload.target = "node";
    payload.node = targetValue;
  }

  // Abort any in-flight query.
  if (queryAbort) queryAbort.abort();
  const controller = new AbortController();
  queryAbort = controller;

  // Show "Running…" only if the query takes longer than 300ms.
  let runningTimer = setTimeout(() => {
    runningTimer = null;
    if (resultEl.isConnected) {
      resultEl.innerHTML = `
        <div class="flex items-center justify-center gap-3 py-6">
          <span class="text-sm text-slate-500">Running…</span>
          <button data-cancel-query class="px-2 py-1 rounded text-xs font-medium bg-slate-200 hover:bg-slate-300 text-slate-700">Cancel</button>
        </div>
      `;
      resultEl.querySelector("[data-cancel-query]").addEventListener("click", () => controller.abort());
    }
  }, 500);

  let result;
  try {
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    result = await res.json();
  } catch (e) {
    result = e && e.name === "AbortError"
      ? { error: "Query cancelled" }
      : { error: "Failed to run query: " + (e && e.message) };
  }
  if (runningTimer) clearTimeout(runningTimer);
  renderQueryResult(result, resultEl);
}

function renderQueryResult(result, el) {
  const meta = $("query-meta");
  if (meta) meta.innerHTML = "";

  if (result.error) {
    el.innerHTML = `<div class="p-3 text-sm text-red-600 font-mono whitespace-pre-wrap">${escapeHtml(result.error)}</div>`;
    return;
  }
  if (result.operation === "exec") {
    el.innerHTML = `<div class="p-3 text-sm text-emerald-600">Executed — ${result.affected} row(s) affected (${result.duration_ms}ms)</div>`;
    return;
  }
  const columns = result.columns || [];
  const columnTypes = result.column_types || [];
  const rows = result.rows || [];
  if (!rows.length) {
    el.innerHTML = '<div class="p-3 text-sm text-slate-500">The query returned no results.</div>';
    return;
  }
  let html = '<table class="min-w-full border-separate border-spacing-0 text-sm">';
  html += '<thead><tr>';
  for (let i = 0; i < columns.length; i++) {
    const type = columnTypes[i] || "";
    html += `<th class="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left border-b border-slate-200"><div class="max-w-[150px] overflow-x-auto no-scrollbar"><div class="text-sm font-semibold text-slate-700 whitespace-nowrap">${escapeHtml(columns[i])}</div>${type ? `<div class="text-xs font-normal text-slate-500 whitespace-nowrap">${escapeHtml(type.toUpperCase())}</div>` : ""}</div></th>`;
  }
  html += '</tr></thead><tbody class="divide-y divide-slate-100">';
  for (const row of rows) {
    html += '<tr class="odd:bg-white even:bg-slate-50 hover:bg-slate-100">';
    for (const cell of row) {
      html += `<td class="px-3 py-1.5 text-sm text-slate-700 align-top"><div class="max-w-[150px] overflow-x-auto no-scrollbar whitespace-nowrap">${formatCell(cell)}</div></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;

  if (meta) {
    meta.innerHTML = `<div class="text-xs text-slate-400">${rows.length} row(s) · ${result.duration_ms}ms</div>`;
  }
}

function formatCell(v) {
  if (v === null || v === undefined) return '<span class="text-slate-300">NULL</span>';
  return escapeHtml(String(v));
}

// ---- users (admin) ----

function showUsersAction() {
  $("main-content").innerHTML = `
    <div class="flex-1 min-h-0 flex flex-col bg-white rounded-lg shadow p-4 gap-3">
      <div class="flex items-center justify-between gap-3">
        <div class="text-lg font-semibold text-slate-800">Users</div>
        <button id="add-user" class="rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold px-4 py-2">Add user</button>
      </div>
      <div id="users-table" class="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-lg nice-scrollbar"></div>
    </div>
  `;
  $("add-user").addEventListener("click", () => openUserForm(null));
  loadUsers();
}

async function loadUsers() {
  const res = await fetch("/api/users");
  const data = await res.json();
  const container = $("users-table");
  if (!container) return;
  if (!res.ok || data.error) {
    container.innerHTML = `<div class="p-6 text-sm text-red-600">${escapeHtml(data.error || "Failed to load users")}</div>`;
    return;
  }
  const users = data.users || [];
  if (!users.length) {
    container.innerHTML = '<div class="p-6 text-sm text-slate-500">No users.</div>';
    return;
  }
  const roleBadge = (admin) =>
    admin
      ? '<span class="inline-flex items-center rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">Admin</span>'
      : '<span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">User</span>';
  const dash = '<span class="text-slate-300">—</span>';
  const dbField = (db, key) => {
    const v = db && db[key];
    return v ? escapeHtml(String(v)) : dash;
  };
  const dbParams = (db) => {
    const parts = [];
    for (const [k, v] of Object.entries(db || {})) {
      if (k === "username" || k === "password" || k === "dbname") continue;
      parts.push(`${k}=${v}`);
    }
    if (!parts.length) return dash;
    return `<span class="font-mono text-xs text-slate-600">${parts.map(escapeHtml).join(", ")}</span>`;
  };
  container.innerHTML = `
    <table class="min-w-full border-separate border-spacing-0 text-sm">
      <thead><tr>
        <th class="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">Username</th>
        <th class="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">Role</th>
        <th class="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">PG User</th>
        <th class="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">PG Database</th>
        <th class="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">Params</th>
        <th class="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right text-sm font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">Actions</th>
      </tr></thead>
      <tbody class="divide-y divide-slate-100">
      ${users
        .map(
          (u, i) => `
        <tr class="odd:bg-white even:bg-slate-50 hover:bg-slate-100">
          <td class="px-3 py-2 text-slate-800 font-medium">${escapeHtml(u.username)}</td>
          <td class="px-3 py-2">${roleBadge(u.admin)}</td>
          <td class="px-3 py-2 font-mono text-slate-700">${dbField(u.database, "username")}</td>
          <td class="px-3 py-2 font-mono text-slate-700">${dbField(u.database, "dbname")}</td>
          <td class="px-3 py-2">${dbParams(u.database)}</td>
          <td class="px-3 py-2 text-right whitespace-nowrap">
            <button data-edit="${i}" class="px-2 py-1 rounded text-xs font-medium bg-slate-200 hover:bg-slate-300 text-slate-700">Edit</button>
            <button data-del="${i}" class="ml-1 px-2 py-1 rounded text-xs font-medium bg-red-100 hover:bg-red-200 text-red-700">Delete</button>
          </td>
        </tr>`
        )
        .join("")}
      </tbody>
    </table>`;
  container.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => openUserForm(users[Number(b.dataset.edit)]));
  });
  container.querySelectorAll("[data-del]").forEach((b) => {
    b.addEventListener("click", () => confirmDeleteUser(users[Number(b.dataset.del)]));
  });
}

function databaseParamsLines(db) {
  const lines = [];
  for (const [k, v] of Object.entries(db || {})) {
    if (k === "username" || k === "password" || k === "dbname") continue;
    lines.push(`${k}=${v}`);
  }
  return lines.join("\n");
}

function openUserForm(user) {
  const isEdit = !!user;
  const db = (user && user.database) || {};
  const inputCls =
    "w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-1">${isEdit ? "Edit user" : "Add user"}</div>
    <div id="user-error" class="hidden mb-2 text-sm text-red-600"></div>
    <div class="space-y-2">
      <input id="u-username" type="text" placeholder="Username" ${isEdit ? "disabled" : ""} value="${escapeHtml(isEdit ? user.username : "")}" class="${inputCls}" />
      <input id="u-password" type="password" placeholder="${isEdit ? "New password (leave blank to keep)" : "Password"}" class="${inputCls}" />
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input id="u-admin" type="checkbox" ${isEdit && user.admin ? "checked" : ""} class="h-4 w-4 rounded border-slate-300 accent-brand focus:ring-brand" />
        <span class="text-sm text-slate-700">Administrator</span>
      </label>
      <div class="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Database access</div>
      <input id="u-db-user" type="text" placeholder="Database username" value="${escapeHtml(db.username || "")}" class="${inputCls}" />
      <input id="u-db-pass" type="password" placeholder="Database password" value="${escapeHtml(db.password || "")}" class="${inputCls}" />
      <input id="u-db-name" type="text" placeholder="Database name" value="${escapeHtml(db.dbname || "")}" class="${inputCls}" />
      <textarea id="u-db-params" rows="3" placeholder="Extra parameters (one per line):&#10;sslmode=disable&#10;application_name=patroni_ui_backend" spellcheck="false" class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500">${escapeHtml(databaseParamsLines(db))}</textarea>
    </div>
    <div class="flex gap-2 mt-3">
      <button data-save class="flex-1 px-3 py-2 rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold">${isEdit ? "Save" : "Create"}</button>
      <button data-cancel class="flex-1 px-3 py-2 rounded bg-slate-200 hover:bg-slate-300 text-sm font-semibold">Cancel</button>
    </div>
  `;
  showModal();
  $("modal").querySelector("[data-cancel]").addEventListener("click", closeModal);
  $("modal").querySelector("[data-save]").addEventListener("click", () => saveUser(user));
}

async function saveUser(user) {
  const err = $("user-error");
  const fail = (msg) => {
    err.textContent = msg;
    err.classList.remove("hidden");
  };

  const username = $("u-username").value.trim();
  const password = $("u-password").value;
  const admin = $("u-admin").checked;
  const dbUser = $("u-db-user").value.trim();
  const dbPass = $("u-db-pass").value;
  const dbName = $("u-db-name").value.trim();
  const paramsText = $("u-db-params").value;

  if (!username) return fail("Username is required");
  if (!user && !password) return fail("Password is required");

  const database = {};
  if (dbUser) database.username = dbUser;
  if (dbPass) database.password = dbPass;
  if (dbName) database.dbname = dbName;
  for (const line of paramsText.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const idx = t.indexOf("=");
    if (idx <= 0) continue;
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    if (k) database[k] = v;
  }

  const isEdit = !!user;
  const body = { admin, database };
  if (isEdit) {
    if (password) body.password = password;
  } else {
    body.username = username;
    body.password = password;
  }

  const res = await fetch(
    isEdit ? `/api/users/${encodeURIComponent(user.username)}` : "/api/users",
    {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok || data.error) {
    fail(data.error || "Failed to save user");
    return;
  }
  closeModal();
  showStatus(isEdit ? "User updated" : "User created", "text-emerald-300");
  loadUsers();
}

function confirmDeleteUser(user) {
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-1">Delete ${escapeHtml(user.username)}?</div>
    <div class="text-sm text-slate-600 mb-4">This will remove the user account.</div>
    <div class="flex items-center justify-end gap-2">
      <button data-no class="px-4 py-2 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold">Cancel</button>
      <button data-yes class="px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-semibold">Delete</button>
    </div>
  `;
  showModal();
  $("modal").querySelector("[data-yes]").addEventListener("click", () => {
    closeModal();
    deleteUser(user);
  });
  $("modal").querySelector("[data-no]").addEventListener("click", closeModal);
}

async function deleteUser(user) {
  const res = await fetch(`/api/users/${encodeURIComponent(user.username)}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    showStatus(data.error || "Failed to delete user", "text-red-400");
    return;
  }
  showStatus("User deleted", "text-emerald-300");
  loadUsers();
}

// ---- cluster connection (admin) ----

async function loadClusterConfigured() {
  try {
    const res = await fetch("/api/cluster/status");
    const data = await res.json();
    state.clusterConfigured = !!data.configured;
  } catch {
    state.clusterConfigured = false;
  }
}

function showNoClusterAction() {
  const admin = state.isAdmin;
  $("main-content").innerHTML = `
    <div class="flex-1 min-h-0 flex flex-col items-center justify-center bg-white rounded-lg shadow p-8 text-center">
      <svg class="w-12 h-12 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>
      <div class="mt-4 text-lg font-semibold text-slate-800">No cluster configured</div>
      <div class="mt-1 max-w-md text-sm text-slate-500">${
        admin
          ? "Connect to a Patroni cluster to start monitoring and managing it."
          : "The administrator has not configured a Patroni cluster yet. Please contact an administrator."
      }</div>
      ${
        admin
          ? '<button id="add-cluster" class="mt-5 rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold px-4 py-2">Add cluster</button>'
          : ""
      }
    </div>
  `;
  const btn = $("add-cluster");
  if (btn) btn.addEventListener("click", openClusterModal);
}

function clusterFormHtml(cfg) {
  const hosts = cfg && cfg.hosts ? cfg.hosts.join(", ") : "";
  const username = (cfg && cfg.username) || "";
  const password = (cfg && cfg.password) || "";
  const insecure = !!(cfg && cfg.insecure);
  const ca = (cfg && cfg.ca) || "";
  const inputCls =
    "w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand";
  return `
    <div class="space-y-4">
      <div>
        <label for="cl-hosts" class="block text-sm font-medium text-slate-700 mb-1.5">Patroni hosts</label>
        <input id="cl-hosts" type="text" value="${escapeHtml(hosts)}" placeholder="http://10.0.0.1:8008, http://10.0.0.2:8008" class="${inputCls}" />
        <p class="mt-1.5 text-xs text-slate-500">Comma-separated list of Patroni REST API base URLs.</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label for="cl-username" class="block text-sm font-medium text-slate-700 mb-1.5">Username <span class="font-normal text-slate-400">(optional)</span></label>
          <input id="cl-username" type="text" autocomplete="off" value="${escapeHtml(username)}" class="${inputCls}" />
        </div>
        <div>
          <label for="cl-password" class="block text-sm font-medium text-slate-700 mb-1.5">Password <span class="font-normal text-slate-400">(optional)</span></label>
          <input id="cl-password" type="password" autocomplete="new-password" value="${escapeHtml(password)}" class="${inputCls}" />
        </div>
      </div>
      <div class="rounded-md border border-slate-200 bg-slate-50 p-3">
        <label class="flex items-start gap-2.5 cursor-pointer select-none">
          <input id="cl-insecure" type="checkbox" ${insecure ? "checked" : ""} class="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-brand focus:ring-brand" />
          <span class="text-sm text-slate-700">Disable TLS certificate verification <span class="text-slate-400">(insecure)</span></span>
        </label>
        <p class="mt-1 pl-7 text-xs text-slate-500">Skip certificate verification for requests to the Patroni REST API.</p>
      </div>
      <div>
        <label for="cl-ca" class="block text-sm font-medium text-slate-700 mb-1.5">Certificate <span class="font-normal text-slate-400">(optional, PEM)</span></label>
        <textarea id="cl-ca" rows="4" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono shadow-sm focus:outline-none focus:ring-2 focus:ring-brand">${escapeHtml(ca)}</textarea>
        <p class="mt-1.5 text-xs text-slate-500">Custom CA certificate used to verify the Patroni REST API TLS connection.</p>
      </div>
    </div>
  `;
}

function openClusterModal() {
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-1">Add cluster</div>
    <div class="text-sm text-slate-500 mb-3">Configure the connection to the Patroni REST API.</div>
    <div id="cluster-error" class="hidden mb-2 text-sm text-red-600"></div>
    ${clusterFormHtml(null)}
    <div class="flex items-center justify-end gap-2 mt-4">
      <span id="cluster-test-status" class="text-sm text-slate-500"></span>
      <button data-test class="px-3 py-2 rounded border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-100">Test Connection</button>
      <button data-cancel class="px-3 py-2 rounded bg-slate-200 hover:bg-slate-300 text-sm font-semibold">Cancel</button>
      <button data-save class="px-3 py-2 rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold">Create</button>
    </div>
  `;
  showModal("max-w-xl");
  $("modal").querySelector("[data-test]").addEventListener("click", testCluster);
  $("modal").querySelector("[data-cancel]").addEventListener("click", closeModal);
  $("modal").querySelector("[data-save]").addEventListener("click", () => saveCluster());
}

function readClusterForm() {
  const hostsText = $("cl-hosts").value.trim();
  const hosts = hostsText
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return {
    hosts,
    username: $("cl-username").value.trim(),
    password: $("cl-password").value,
    insecure: $("cl-insecure").checked,
    ca: $("cl-ca").value.trim(),
  };
}

async function saveCluster() {
  const err = $("cluster-error");
  const fail = (msg) => {
    if (err) {
      err.textContent = msg;
      err.classList.remove("hidden");
    }
  };

  const { hosts, username, password, insecure, ca } = readClusterForm();
  if (!hosts.length) {
    fail("At least one Patroni host is required");
    return;
  }

  let res;
  try {
    res = await fetch("/api/cluster", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hosts, username, password, insecure, ca }),
    });
  } catch (e) {
    fail("Could not reach the server: " + (e && e.message ? e.message : e));
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    fail("Server returned an invalid response (HTTP " + res.status + ")");
    return;
  }

  if (!res.ok || data.error) {
    fail(data.error || "Failed to save cluster (HTTP " + res.status + ")");
    return;
  }

  if (err) err.classList.add("hidden");

  if (state.clusterConfigured) {
    // Updating an existing cluster: stay on the page.
    showStatus("Cluster saved", "text-emerald-300");
  } else {
    // First-time setup: redirect to the dashboard.
    window.location.href = "/";
  }
}

async function testCluster() {
  const statusEl = $("cluster-test-status");
  const setStatus = (msg, cls) => {
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.className = "text-sm " + cls;
    }
  };

  const { hosts, username, password, insecure, ca } = readClusterForm();
  if (!hosts.length) {
    setStatus("At least one Patroni host is required", "text-red-600");
    return;
  }

  setStatus("Testing…", "text-slate-500");
  try {
    const res = await fetch("/api/cluster/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hosts, username, password, insecure, ca }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || "Test failed", "text-red-600");
      return;
    }
    if (data.status_code >= 200 && data.status_code < 300 && !data.error) {
      setStatus("Connection OK", "text-emerald-600");
    } else {
      const detail = data.error || "HTTP " + (data.status_code || "error");
      setStatus("Failed: " + detail, "text-red-600");
    }
  } catch (e) {
    setStatus("Test failed: " + (e && e.message ? e.message : e), "text-red-600");
  }
}

function showClusterConfigAction() {
  const configured = state.clusterConfigured;
  $("main-content").innerHTML = `
    <div class="flex-1 min-h-0 flex flex-col bg-white rounded-lg shadow p-4 gap-3">
      <div class="flex items-center justify-between gap-3">
        <div class="text-lg font-semibold text-slate-800">Cluster Connection</div>
        <button id="delete-cluster" class="${configured ? "" : "hidden"} px-3 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-semibold">Delete</button>
      </div>
      <div id="cluster-error" class="hidden mb-2 text-sm text-red-600"></div>
      <div id="cluster-form" class="flex-1 min-h-0 overflow-auto -mx-1 px-1 py-1"></div>
      <div class="flex items-center justify-end gap-2">
        <span id="cluster-test-status" class="text-sm text-slate-500"></span>
        <button id="test-cluster" class="px-3 py-2 rounded border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-100">Test Connection</button>
        <button id="save-cluster" class="px-3 py-2 rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold">Save</button>
      </div>
    </div>
  `;
  $("delete-cluster").addEventListener("click", confirmDeleteCluster);
  $("test-cluster").addEventListener("click", testCluster);
  $("save-cluster").addEventListener("click", () => saveCluster());
  loadClusterConfig();
}

async function loadClusterConfig() {
  const res = await fetch("/api/cluster");
  const data = await res.json();
  const container = $("cluster-form");
  if (!container) return;
  if (!res.ok || data.error) {
    container.innerHTML = `<div class="p-4 text-sm text-red-600">${escapeHtml(data.error || "Failed to load cluster")}</div>`;
    return;
  }
  container.innerHTML = clusterFormHtml(data);
  state.clusterConfigured = !!data.configured;
  const del = $("delete-cluster");
  if (del) del.classList.toggle("hidden", !data.configured);
}

function confirmDeleteCluster() {
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-1">Delete cluster?</div>
    <div class="text-sm text-slate-600 mb-4">This will remove the configured Patroni cluster connection.</div>
    <div class="flex items-center justify-end gap-2">
      <button data-no class="px-4 py-2 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold">Cancel</button>
      <button data-yes class="px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-semibold">Delete</button>
    </div>
  `;
  showModal();
  $("modal").querySelector("[data-yes]").addEventListener("click", () => {
    closeModal();
    deleteCluster();
  });
  $("modal").querySelector("[data-no]").addEventListener("click", closeModal);
}

async function deleteCluster() {
  const res = await fetch("/api/cluster", { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    showStatus(data.error || "Failed to delete cluster", "text-red-400");
    return;
  }
  window.location.reload();
}

async function loadScheduledEvents() {
  const result = await apiCall("GET", "/cluster");
  const container = $("scheduled-events");
  if (!container) return;
  if (result.error || result.status_code >= 400) {
    container.innerHTML = `<div class="text-sm text-red-600">${escapeHtml(result.error || "Failed to load events")}</div>`;
    return;
  }
  renderScheduledEvents(result.data, container);
}

// ---- polling ----

async function pollCluster() {
  try {
    const result = await apiCall("GET", "/cluster");
    if (result.error || result.status_code >= 400) {
      updateFavicon(null);
      return;
    }
    const eventsContainer = $("scheduled-events");
    if (eventsContainer) renderScheduledEvents(result.data, eventsContainer);
    const members = extractMembers(result.data);
    if (!members || !members.length) {
      updateFavicon(null);
      return;
    }
    const sig = clusterSignature(members);
    if (sig !== state.clusterSignature) {
      state.clusterSignature = sig;
      if (state.currentAction === "cluster") {
        const container = $("cluster-tree");
        if (container) {
          const scope = result.data && result.data.scope != null ? String(result.data.scope) : "";
          renderClusterTree(members, container, scope);
          applyPatroniInfo();
          loadNodeSync();
        }
      }
    }
    updateClusterAlert(members);
    updateFavicon(members);
  } catch {
    // ignore
  }
}

// ---- account ----

async function loadMe() {
  try {
    const res = await fetch("/api/me");
    const data = await res.json();
    state.isAdmin = !!data.admin;
    const username = data.username || "";
    if (!username) return;
    $("account-username").textContent = username;
    $("account-avatar").textContent = username.charAt(0).toUpperCase();
  } catch {
    // ignore
  }
}

async function logout() {
  try {
    // Force the browser to forget cached Basic-auth credentials by sending an
    // invalid Authorization header, then reload so it re-prompts for login.
    await fetch("/api/me", {
      headers: { Authorization: "Basic " + btoa("logout:logout") },
    });
  } catch {
    // ignore
  }
  window.location.reload();
}

function openChangePassword() {
  $("modal").innerHTML = `
    <div class="text-xl font-semibold text-slate-800 mb-1">Change password</div>
    <div class="text-sm text-slate-600 mb-3">Signed in as ${escapeHtml($("account-username").textContent)}</div>
    <div id="pw-error" class="hidden mb-2 text-sm text-red-600"></div>
    <div class="space-y-2">
      <input id="pw-current" type="password" placeholder="Current password" class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      <input id="pw-new" type="password" placeholder="New password" class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      <input id="pw-confirm" type="password" placeholder="Confirm new password" class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
    <div class="flex gap-2 mt-3">
      <button data-save class="flex-1 px-3 py-2 rounded bg-brand hover:bg-brand-hover text-white text-sm font-semibold">Save</button>
      <button data-cancel class="flex-1 px-3 py-2 rounded bg-slate-200 hover:bg-slate-300 text-sm font-semibold">Cancel</button>
    </div>
    <button data-logout class="w-full mt-3 px-3 py-2 rounded text-sm font-semibold text-white bg-red-500 hover:bg-red-600">Log out</button>
  `;
  showModal();
  $("modal").querySelector("[data-logout]").addEventListener("click", logout);
  $("modal").querySelector("[data-save]").addEventListener("click", async () => {
    const current = $("pw-current").value;
    const next = $("pw-new").value;
    const confirm = $("pw-confirm").value;
    const err = $("pw-error");
    if (!next) {
      err.textContent = "New password is required";
      err.classList.remove("hidden");
      return;
    }
    if (next !== confirm) {
      err.textContent = "Passwords do not match";
      err.classList.remove("hidden");
      return;
    }
    const res = await fetch("/api/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      err.textContent = data.error || "Failed to change password";
      err.classList.remove("hidden");
      return;
    }
    closeModal();
    showStatus("Password updated", "text-emerald-300");
  });
  $("modal").querySelector("[data-cancel]").addEventListener("click", closeModal);
}

// ---- init ----

function toggleSidebar() {
  const sidebar = $("sidebar");
  const backdrop = $("sidebar-backdrop");
  if (!sidebar || !backdrop) return;
  const isOpen = !sidebar.classList.contains("-translate-x-full");
  if (isOpen) {
    sidebar.classList.add("-translate-x-full");
    backdrop.classList.add("hidden");
  } else {
    sidebar.classList.remove("-translate-x-full");
    backdrop.classList.remove("hidden");
  }
}

function closeSidebar() {
  const sidebar = $("sidebar");
  const backdrop = $("sidebar-backdrop");
  if (sidebar) sidebar.classList.add("-translate-x-full");
  if (backdrop) backdrop.classList.add("hidden");
}

async function initApp() {
  $("account-button").addEventListener("click", openChangePassword);
  $("menu-button").addEventListener("click", toggleSidebar);
  $("sidebar-backdrop").addEventListener("click", closeSidebar);
  $("brand-button").addEventListener("click", (e) => {
    e.preventDefault();
    const path = pathForAction("cluster");
    if (window.location.pathname !== path) {
      history.pushState({ action: "cluster" }, "", path);
    }
    switchAction("cluster");
    closeSidebar();
  });

  window.addEventListener("resize", drawConnectors);
  setInterval(pollCluster, 2000);

  $("modal-overlay").addEventListener("click", (e) => {
    if (e.target === $("modal-overlay")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeSidebar();
    }
  });
  window.addEventListener("popstate", () => {
    switchAction(actionForPath(window.location.pathname));
  });

  // Wait for the current user so the sidebar and header render fully-formed
  // before revealing the app (avoids layout flicker).
  await loadMe();
  await loadClusterConfigured();

  renderActionsNav();
  if (state.isAdmin) {
    $("admin-section").classList.remove("hidden");
    renderAdminNav();
  }
  document.querySelectorAll("#actions-nav [data-action], #admin-nav [data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const actionId = btn.dataset.action;
      const path = pathForAction(actionId);
      if (window.location.pathname !== path) {
        history.pushState({ action: actionId }, "", path);
      }
      switchAction(actionId);
      closeSidebar();
    });
  });

  if (state.clusterConfigured) {
    loadScheduledEvents();
  }
  switchAction(actionForPath(window.location.pathname));

  $("app-header").classList.remove("hidden");
  $("app-main").classList.remove("hidden");
}

function init() {
  initApp();
}

document.addEventListener("DOMContentLoaded", init);
