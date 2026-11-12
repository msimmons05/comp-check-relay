// Shared helpers for the Comp Check relay.
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2026-10-21";
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
export const teamPassword = () => process.env.TEAM_PASSWORD || process.env.Team_Password || process.env.team_password || "";

export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Team-Password");
}

export const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const clean = (s, max = 400) => (s === null || s === undefined ? "" : String(s).slice(0, max));

export function extractJson(text) {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

export const CONDITIONS = ["renovated", "average", "distressed"];
export function normSources(c) {
  return (Array.isArray(c?.sources) ? c.sources : c?.source_url ? [{ site: "", url: c.source_url }] : [])
    .filter((x) => x && /^https?:\/\//.test(x.url || ""))
    .slice(0, 6)
    .map((x) => ({ site: clean(x.site, 30) || (x.url.match(/\/\/(?:www\.)?([^/]+)/) || [])[1] || "Source", url: clean(x.url, 500) }));
}

export const SYSTEM =
  "You are a careful residential real estate underwriting analyst for a private hard money lender. You find closed sales only, verify every figure on a source page, and never fabricate data. The Comp Check app separately measures distance and looks up city and school district for every address, so never spend searches on distance or school districts.";

/** Gate a request: CORS, health check, method, configuration, password. Returns parsed body or null if already answered. */
export function gate(req, res) {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).end(); return null; }
  if (req.method === "GET") { res.status(200).json({ ok: true, configured: !!(process.env.ANTHROPIC_API_KEY && teamPassword()) }); return null; }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return null; }
  if (!process.env.ANTHROPIC_API_KEY || !teamPassword()) {
    res.status(500).json({ error: "The relay isn't set up yet: add ANTHROPIC_API_KEY and TEAM_PASSWORD in Vercel, then redeploy." });
    return null;
  }
  if ((req.headers["x-team-password"] || "") !== teamPassword()) { res.status(401).json({ error: "Wrong team password." }); return null; }
  try { return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; }
  catch { res.status(400).json({ error: "Bad request body." }); return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(body) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": API_VERSION, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { r, data };
}

/** Run one Claude turn with server tools, following pause_turn, retrying rate limits. Returns {text, usage}. */
export async function runClaude({ prompt, tools, maxTokens = 6000, deadlineMs = 270000 }) {
  const started = Date.now();
  const messages = [{ role: "user", content: prompt }];
  const usage = { input_tokens: 0, output_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 };
  let resp;
  for (let i = 0; i < 8; i++) {
    let attempt = 0, out;
    while (true) {
      out = await once({ model: MODEL, max_tokens: maxTokens, system: SYSTEM, messages, tools });
      const st = out.r.status;
      if ((st === 429 || st === 529 || st === 503) && attempt < 3 && Date.now() - started < deadlineMs - 20000) {
        const ra = Number(out.r.headers.get("retry-after")) || 5 * (attempt + 1);
        await sleep(Math.min(ra, 20) * 1000);
        attempt++;
        continue;
      }
      break;
    }
    if (!out.r.ok) {
      const e = new Error(out.r.status === 429 ? "Claude is busy (rate limit). Wait a minute and try again." : out.data?.error?.message || `Claude API error ${out.r.status}`);
      e.status = out.r.status;
      throw e;
    }
    resp = out.data;
    usage.input_tokens += resp.usage?.input_tokens || 0;
    usage.output_tokens += resp.usage?.output_tokens || 0;
    usage.web_search_requests += resp.usage?.server_tool_use?.web_search_requests || 0;
    usage.web_fetch_requests += resp.usage?.server_tool_use?.web_fetch_requests || 0;
    if (resp.stop_reason !== "pause_turn" || Date.now() - started > deadlineMs) break;
    messages.push({ role: "assistant", content: resp.content });
  }
  const text = (resp?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return { text, usage };
}
