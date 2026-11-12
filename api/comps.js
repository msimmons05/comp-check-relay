// Comp Check relay: receives a subject property + filters from the Comp Check page,
// asks Claude (with web search + web fetch) to find SOLD comps, and returns clean JSON.
// Env vars (set in Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  (required)  your sk-ant-... key
//   TEAM_PASSWORD      (required)  the password your team types into the page
//   CLAUDE_MODEL       (optional)  defaults to claude-sonnet-5-5

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2026-10-21";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const TEAM_PASSWORD = process.env.TEAM_PASSWORD || process.env.Team_Password || process.env.team_password || "";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Team-Password");
}

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const clean = (s, max = 400) => (s === null || s === undefined ? "" : String(s).slice(0, max));

function buildPrompt(b) {
  const s = b.subject || {};
  const lines = [
    `Find SOLD comparable properties for an after-repair value (ARV) on a fix-and-flip loan.`,
    ``,
    `SUBJECT PROPERTY: ${clean(s.address)}`,
    s.beds ? `- Bedrooms after rehab: ${clean(s.beds, 10)}` : `- Bedrooms: unknown, look it up`,
    s.baths ? `- Bathrooms after rehab: ${clean(s.baths, 10)}` : `- Bathrooms: unknown, look it up`,
    s.sqft ? `- Finished square feet after rehab: ${clean(s.sqft, 10)}` : `- Square feet: unknown, look it up`,
    s.yearBuilt ? `- Year built: ${clean(s.yearBuilt, 10)}` : ``,
    s.type ? `- Property type: ${clean(s.type, 40)}` : ``,
    s.city ? `- Municipality: ${clean(s.city, 80)}` : ``,
    s.school ? `- School district: ${clean(s.school, 120)}` : ``,
    ``,
    `SEARCH RULES:`,
    `- Only homes that have actually SOLD (closed). Never use active, pending, or list-price-only listings.`,
    `- Sold within the last ${num(b.months) || 6} months if possible; extend to 12 months only if you cannot find enough, and say so.`,
    `- Within ${num(b.radius) || 1} mile(s) of the subject; stay in the same municipality and school district when possible.`,
    `- Similar property type, size within about 20% of the subject's square feet, similar bed/bath count and age.`,
    `- For ARV, prefer renovated/updated sales. Flag distressed, foreclosure, or as-is sales.`,
    `- Find up to ${num(b.count) || 6} comps.`,
    b.notes ? `- Extra instructions from the underwriter: ${clean(b.notes, 600)}` : ``,
    ``,
    `CONDITION: judge condition only from the listing description/remarks text, never guess.`,
    `- "renovated" only if the text says updated, remodeled, renovated, rehabbed, new kitchen/baths/flooring, flip, etc.`,
    `- "distressed" if it says as-is, needs work, fixer, TLC, cash only, investor special, foreclosure, estate sale needing updates.`,
    `- "average" if it says original, dated, well maintained without updates, or similar.`,
    `- Otherwise "unknown". Put the exact words you relied on (max 15 words) in condition_evidence.`,
    ``,
    `HOW TO SEARCH (be efficient, aim to finish quickly):`,
    `- Start from "recently sold" list pages for the subject's ZIP/neighborhood on Redfin and Realtor.com first, then Homes.com and Zillow. List pages show many sales at once; prefer them over opening house after house.`,
    `- Confirm each comp's sale on at least TWO different sites when you can (e.g. Redfin + Realtor.com). Record every site where you saw the sale in "sources". If sites disagree on price or date, say so in notes and use the figure from the most detailed page.`,
    `- Open an individual property page only when you need its description for condition, or to confirm a sale you can't confirm otherwise.`,
    `- Use only facts you actually saw on a page. If a value is not shown, use null. Never invent a sale.`,
    ``,
    `OUTPUT: after researching, reply with ONLY one JSON object (no prose, no markdown fences) in exactly this shape:`,
    `{"subject":{"beds":number|null,"baths":number|null,"sqft":number|null,"year_built":number|null,"notes":string},`,
    ` "comps":[{"address":"full street address, city, state ZIP","sold_price":number,"sold_date":"YYYY-MM-DD or YYYY-MM or null","beds":number|null,"baths":number|null,"sqft":number|null,"year_built":number|null,"property_type":string|null,"condition":"renovated"|"average"|"distressed"|"unknown","condition_evidence":string|null,"notes":"why it is or isn't a strong comp, max 25 words","sources":[{"site":"Redfin|Realtor.com|Zillow|Homes.com|other name","url":"page where you saw the sale"}]}],`,
    ` "arv":{"low":number|null,"point":number|null,"high":number|null,"method":"one or two sentences"},`,
    ` "warnings":[strings]}`,
  ];
  return lines.filter((l) => l !== "").join("\n").replace(/\n(SEARCH RULES|CONDITION|HOW TO SEARCH|OUTPUT)/g, "\n\n$1");
}

function extractJson(text) {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

function normalize(data) {
  const comps = Array.isArray(data?.comps) ? data.comps : [];
  return {
    subject: data?.subject || {},
    comps: comps
      .filter((c) => c && c.address && num(c.sold_price))
      .map((c) => ({
        address: clean(c.address, 200),
        sold_price: num(c.sold_price),
        sold_date: c.sold_date ? clean(c.sold_date, 20) : null,
        beds: num(c.beds),
        baths: num(c.baths),
        sqft: num(c.sqft),
        year_built: num(c.year_built),
        property_type: c.property_type ? clean(c.property_type, 40) : null,
        condition: ["renovated", "average", "distressed"].includes(c.condition) ? c.condition : "unknown",
        condition_evidence: c.condition_evidence ? clean(c.condition_evidence, 200) : null,
        notes: clean(c.notes, 300),
        sources: (Array.isArray(c.sources) ? c.sources : c.source_url ? [{ site: "", url: c.source_url }] : [])
          .filter((x) => x && /^https?:\/\//.test(x.url || ""))
          .slice(0, 5)
          .map((x) => ({ site: clean(x.site, 30) || (x.url.match(/\/\/(?:www\.)?([^/]+)/) || [])[1] || "Source", url: clean(x.url, 500) })),
      })),
    arv: {
      low: num(data?.arv?.low),
      point: num(data?.arv?.point),
      high: num(data?.arv?.high),
      method: clean(data?.arv?.method, 600),
    },
    warnings: Array.isArray(data?.warnings) ? data.warnings.slice(0, 8).map((w) => clean(w, 300)) : [],
  };
}

async function callClaude(messages) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system:
        "You are a careful residential real estate underwriting analyst for a private hard money lender. You find closed sales only, verify every figure on a source page, and never fabricate data.",
      messages,
      tools: [
        { type: "web_search_20260318", name: "web_search", max_uses: 8, user_location: { type: "approximate", country: "US" } },
        { type: "web_fetch_20260318", name: "web_fetch", max_uses: 10, max_content_tokens: 20000 },
      ],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || `Claude API error ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, configured: !!(process.env.ANTHROPIC_API_KEY && TEAM_PASSWORD) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  if (!process.env.ANTHROPIC_API_KEY || !TEAM_PASSWORD) {
    return res.status(500).json({ error: "The relay isn't set up yet: add ANTHROPIC_API_KEY and TEAM_PASSWORD in Vercel, then redeploy." });
  }
  if ((req.headers["x-team-password"] || "") !== TEAM_PASSWORD) {
    return res.status(401).json({ error: "Wrong team password." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (!body?.subject?.address) return res.status(400).json({ error: "Missing subject address." });

  const messages = [{ role: "user", content: buildPrompt(body) }];
  const usage = { input_tokens: 0, output_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 };

  try {
    let resp;
    for (let i = 0; i < 6; i++) {
      resp = await callClaude(messages);
      usage.input_tokens += resp.usage?.input_tokens || 0;
      usage.output_tokens += resp.usage?.output_tokens || 0;
      usage.web_search_requests += resp.usage?.server_tool_use?.web_search_requests || 0;
      usage.web_fetch_requests += resp.usage?.server_tool_use?.web_fetch_requests || 0;
      if (resp.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: resp.content });
    }

    const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const parsed = extractJson(text);
    if (!parsed) {
      return res.status(502).json({ error: "Claude finished but didn't return comps in the expected format. Try again.", raw: text.slice(-1500), usage });
    }
    return res.status(200).json({ ...normalize(parsed), usage, model: MODEL });
  } catch (e) {
    return res.status(e.status && e.status < 500 ? 502 : 500).json({ error: e.message || "Unexpected error." });
  }
}

export { buildPrompt, extractJson, normalize };
