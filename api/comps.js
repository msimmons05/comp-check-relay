// Step 1: find candidate SOLD comps from "recently sold" list pages.
// Env vars: ANTHROPIC_API_KEY, TEAM_PASSWORD (or Team_Password), optional CLAUDE_MODEL.
import { gate, runClaude, extractJson, num, clean, normSources, CONDITIONS, MODEL } from "../lib/claude.js";

export function cutoff(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function buildPrompt(b) {
  const s = b.subject || {};
  const existing = (Array.isArray(b.existing) ? b.existing : []).slice(0, 25);
  const inner = num(b.searchedRadius) || 0;
  const outer = num(b.radius) || 1;
  const widening = existing.length && inner && outer > inner;
  const haveBlock = existing.length
    ? [
        ``,
        `ALREADY FOUND (do NOT return these again; they are already verified and on the map):`,
        ...existing.map((c) => `- ${clean(c.address, 160)}${num(c.sold_price) ? `, sold $${num(c.sold_price)}` : ""}${c.sold_date ? ` on ${clean(c.sold_date, 20)}` : ""}${num(c.sqft) ? `, ${num(c.sqft)} sq ft` : ""}${c.condition && c.condition !== "unknown" ? `, ${clean(c.condition, 20)}` : ""}${num(c.distance) != null ? `, ${num(c.distance).toFixed(2)} mi away` : ""}`),
        widening
          ? `Earlier searches already covered up to ${inner} mile(s). Look ONLY for additional sales farther out, roughly ${inner} to ${outer} miles from the subject.`
          : `Look only for additional comps that are not in this list.`,
        `Your "arv" must weigh ALL comps together: the ones listed above plus any new ones you find.`,
      ]
    : [];
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
    ``,
    `SEARCH RULES:`,
    `- Only homes that have actually SOLD (closed). Never use active, pending, or list-price-only listings.`,
    `- STRICT DATE LIMIT: sold on or after ${cutoff(num(b.months) || 6)} (the last ${num(b.months) || 6} months; today is ${new Date().toISOString().slice(0, 10)}). Never return an older sale, even if you can't find enough comps. If there are too few, return fewer and add a warning.`,
    `- Within about ${num(b.radius) || 1} mile(s) of the subject, same town/neighborhood when possible. The app measures exact distance afterwards.`,
    `- Similar property type and age, size within about 20-25% of the subject's square feet.`,
    `- BEDROOMS: within one bedroom of the subject (e.g. a 4-bed subject takes 3, 4 or 5-bed comps). Never return a comp 2+ bedrooms off unless there is truly nothing closer in the area, and then say so in its notes. Bathrooms can differ by one.`,
    `- Prefer renovated/updated sales for ARV.`,
    existing.length ? `- Find up to ${num(b.count) || 6} ADDITIONAL comps (fewer is fine if there aren't good ones).` : `- Find up to ${num(b.count) || 6} comps.`,
    b.notes ? `- Extra instructions from the underwriter: ${clean(b.notes, 600)}` : ``,
    ...haveBlock,
    ``,
    `THIS IS STEP 1 OF 2. Your job is to pick the best candidates quickly. A second step will open each comp's own property pages to verify details and condition, so do NOT open individual property pages here except one for the subject if its size is unknown.`,
    `- Work from "recently sold" list pages for the subject's ZIP/neighborhood: Redfin and Realtor.com first, then Homes.com and Zillow.`,
    `- Record every site where you saw each sale in "sources". If you see a condition hint in list-page remarks, use it; otherwise condition "unknown".`,
    `- Use only facts you actually saw. If a value is not shown, use null. Never invent a sale.`,
    `- Speed matters: stop searching as soon as you have enough good candidates. Two or three list pages are usually enough.`,
    ``,
    `OUTPUT: reply with ONLY one JSON object (no prose, no markdown fences):`,
    `{"subject":{"beds":number|null,"baths":number|null,"sqft":number|null,"year_built":number|null,"notes":string},`,
    ` "comps":[{"address":"full street address, city, state ZIP","sold_price":number,"sold_date":"YYYY-MM-DD or YYYY-MM or null","beds":number|null,"baths":number|null,"sqft":number|null,"year_built":number|null,"property_type":string|null,"condition":"renovated"|"average"|"distressed"|"unknown","condition_evidence":string|null,"notes":"why it is a good or weak comp, max 25 words","sources":[{"site":"Redfin|Realtor.com|Zillow|Homes.com|other","url":"page where you saw the sale"}]}],`,
    ` "arv":{"low":number|null,"point":number|null,"high":number|null,"method":"one or two sentences"},`,
    ` "warnings":[short strings]}`,
  ];
  return lines.filter((l) => l !== "").join("\n").replace(/\n(SEARCH RULES|ALREADY FOUND|THIS IS STEP|OUTPUT)/g, "\n\n$1");
}

export function normalize(data) {
  const comps = Array.isArray(data?.comps) ? data.comps : [];
  return {
    subject: data?.subject || {},
    comps: comps
      .filter((c) => c && c.address && num(c.sold_price))
      .map((c) => ({
        address: clean(c.address, 200),
        sold_price: num(c.sold_price),
        sold_date: c.sold_date ? clean(c.sold_date, 20) : null,
        beds: num(c.beds), baths: num(c.baths), sqft: num(c.sqft), year_built: num(c.year_built),
        property_type: c.property_type ? clean(c.property_type, 40) : null,
        condition: CONDITIONS.includes(c.condition) ? c.condition : "unknown",
        condition_evidence: c.condition_evidence ? clean(c.condition_evidence, 200) : null,
        notes: clean(c.notes, 300),
        sources: normSources(c),
      })),
    arv: { low: num(data?.arv?.low), point: num(data?.arv?.point), high: num(data?.arv?.high), method: clean(data?.arv?.method, 600) },
    warnings: Array.isArray(data?.warnings) ? data.warnings.slice(0, 8).map((w) => clean(w, 300)) : [],
  };
}

export default async function handler(req, res) {
  const body = gate(req, res);
  if (!body) return;
  if (!body?.subject?.address) return res.status(400).json({ error: "Missing subject address." });
  try {
    const { text, usage } = await runClaude({
      prompt: buildPrompt(body),
      maxTokens: 8000,
      tools: [
        { type: "web_search_20260318", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "US" } },
        { type: "web_fetch_20260318", name: "web_fetch", max_uses: 6, max_content_tokens: 10000 },
      ],
    });
    const parsed = extractJson(text);
    if (!parsed) return res.status(502).json({ error: "Claude finished but didn't return comps in the expected format. Try again.", raw: text.slice(-1500), usage });
    return res.status(200).json({ ...normalize(parsed), usage, model: MODEL });
  } catch (e) {
    return res.status(e.status && e.status < 500 ? 502 : 500).json({ error: e.message || "Unexpected error." });
  }
}
