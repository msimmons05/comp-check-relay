// Re-estimate ARV from the comps the underwriter has ticked. No web tools, so it's cheap.
import { gate, runClaude, extractJson, num, clean, MODEL } from "../lib/claude.js";

export function buildArvPrompt(b) {
  const s = b.subject || {};
  const comps = (Array.isArray(b.comps) ? b.comps : []).slice(0, 25);
  return [
    `Estimate the after-repair value (ARV) of this subject property for a fix-and-flip loan, using ONLY the comps listed below. The underwriter has already chosen these comps; do not add or look up others.`,
    ``,
    `SUBJECT: ${clean(s.address, 200)}`,
    `After rehab: ${s.beds ?? "?"} bed, ${s.baths ?? "?"} bath, ${s.sqft ?? "?"} sq ft${s.yearBuilt ? `, built ${clean(s.yearBuilt, 10)}` : ""}${s.type ? `, ${clean(s.type, 40)}` : ""}.`,
    s.notes ? `Underwriter notes: ${clean(s.notes, 400)}` : ``,
    ``,
    `COMPS (${comps.length}):`,
    ...comps.map((c, i) =>
      `${i + 1}. ${clean(c.address, 160)}: sold $${num(c.price) ?? "?"}${c.soldDate ? ` on ${clean(c.soldDate, 20)}` : ""}, ${c.beds ?? "?"} bd / ${c.baths ?? "?"} ba, ${num(c.sqft) ?? "?"} sq ft${num(c.sqft) && num(c.price) ? ` ($${Math.round(num(c.price) / num(c.sqft))}/sq ft)` : ""}, condition ${clean(c.condition || "unknown", 20)}${num(c.distance) != null ? `, ${num(c.distance).toFixed(2)} mi away` : ""}${c.notes ? `. Notes: ${clean(c.notes, 200)}` : ""}`),
    ``,
    `Weigh renovated, closer, more recent and more similar comps more heavily; adjust for bed/bath and size differences. Be concrete and brief.`,
    `Reply with ONLY one JSON object: {"low":number,"point":number,"high":number,"method":"two or three sentences on how you got there","warnings":[short strings]}`,
  ].filter((l) => l !== "").join("\n");
}

export default async function handler(req, res) {
  const body = gate(req, res);
  if (!body) return;
  if (!body?.subject?.address || !Array.isArray(body.comps) || !body.comps.length) {
    return res.status(400).json({ error: "Tick at least one comp with a sold price first." });
  }
  try {
    const { text, usage } = await runClaude({ prompt: buildArvPrompt(body), tools: [], maxTokens: 1500, deadlineMs: 60000 });
    const d = extractJson(text);
    if (!d) return res.status(502).json({ error: "Couldn't read Claude's estimate. Try again.", usage });
    return res.status(200).json({
      arv: { low: num(d.low), point: num(d.point), high: num(d.high), method: clean(d.method, 800) },
      warnings: Array.isArray(d.warnings) ? d.warnings.slice(0, 6).map((w) => clean(w, 300)) : [],
      usage, model: MODEL,
    });
  } catch (e) {
    return res.status(e.status && e.status < 500 ? 502 : 500).json({ error: e.message || "Unexpected error." });
  }
}
