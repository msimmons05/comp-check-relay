// Step 2: verify ONE comp's sale on its own property pages (price, date, size, condition).
import { gate, runClaude, extractJson, num, clean, normSources, CONDITIONS, MODEL } from "../lib/claude.js";

export function buildVerifyPrompt(b) {
  const c = b.comp || {};
  const s = b.subject || {};
  const known = [
    c.sold_price ? `sold price ${c.sold_price}` : "",
    c.sold_date ? `sold date ${c.sold_date}` : "",
    c.beds != null ? `${c.beds} beds` : "",
    c.baths != null ? `${c.baths} baths` : "",
    c.sqft ? `${c.sqft} sq ft` : "",
  ].filter(Boolean).join(", ");
  return [
    `Verify the most recent SALE of this one property for an ARV comp: ${clean(c.address, 200)}`,
    known ? `Earlier research reported: ${known}. Check every one of these.` : `No sale details are known yet; find its most recent closed sale.`,
    s.address ? `(It is a comp for the subject at ${clean(s.address, 200)}${s.sqft ? `, ${clean(s.sqft, 10)} sq ft after rehab` : ""}.)` : ``,
    ``,
    `Steps:`,
    `1. Search for this exact address and open its own property detail pages on Redfin, Realtor.com, Zillow and/or Homes.com (aim for two different sites).`,
    `2. From those pages record the last sold price and date, beds, baths, finished sq ft, year built.`,
    `3. Read the listing description/remarks from the sale and judge condition from the wording only:`,
    `   "renovated" = updated/remodeled/renovated/rehabbed/new kitchen, baths or flooring/flip; "distressed" = as-is, needs work, fixer, TLC, cash only, investor special, foreclosure/REO/short sale; "average" = original, dated, maintained without updates; otherwise "unknown". Quote the words you used (max 15 words).`,
    `4. Note any disagreement between sites (price, date, beds, baths, sq ft). Note if it was a non-arm's-length, foreclosure, auction or family sale.`,
    `Zillow and sometimes Redfin block page fetching. If a page won't open, use the text shown in web search results (e.g. "Sold for $310,000 on 5/8/2026") as evidence; that counts as confirming the sale.`,
    `status: "confirmed" if any page or search result shows this sale closed; "not_sold" ONLY if you found positive evidence it did not close (still active, pending, withdrawn, expired, or the sale was cancelled); "unconfirmed" if you simply couldn't access enough information. Never use "not_sold" just because pages were blocked.`,
    `Use only facts you saw on a page; null when not shown. Be quick: do not research the neighborhood.`,
    ``,
    `Reply with ONLY one JSON object (no prose, no fences):`,
    `{"status":"confirmed"|"not_sold"|"unconfirmed","sold_price":number|null,"sold_date":"YYYY-MM-DD or YYYY-MM or null","beds":number|null,"baths":number|null,"sqft":number|null,"year_built":number|null,"condition":"renovated"|"average"|"distressed"|"unknown","condition_evidence":string|null,"sale_type":"standard"|"foreclosure/REO"|"short sale"|"auction"|"non-arm's-length"|"unknown","discrepancies":[short strings],"notes":"max 25 words","sources":[{"site":"Redfin|Realtor.com|Zillow|Homes.com|other","url":"property page you read"}]}`,
  ].filter((l) => l !== "").join("\n");
}

export function normalizeVerify(d) {
  const status = ["confirmed", "not_sold", "unconfirmed"].includes(d?.status) ? d.status : d?.verified === true ? "confirmed" : "unconfirmed";
  return {
    status,
    verified: status === "confirmed",
    sold_price: num(d?.sold_price),
    sold_date: d?.sold_date ? clean(d.sold_date, 20) : null,
    beds: num(d?.beds), baths: num(d?.baths), sqft: num(d?.sqft), year_built: num(d?.year_built),
    condition: CONDITIONS.includes(d?.condition) ? d.condition : "unknown",
    condition_evidence: d?.condition_evidence ? clean(d.condition_evidence, 200) : null,
    sale_type: clean(d?.sale_type || "unknown", 30),
    discrepancies: Array.isArray(d?.discrepancies) ? d.discrepancies.slice(0, 6).map((x) => clean(x, 200)) : [],
    notes: clean(d?.notes, 300),
    sources: normSources(d),
  };
}

export default async function handler(req, res) {
  const body = gate(req, res);
  if (!body) return;
  if (!body?.comp?.address) return res.status(400).json({ error: "Missing comp address." });
  try {
    const { text, usage } = await runClaude({
      prompt: buildVerifyPrompt(body),
      maxTokens: 3000,
      tools: [
        { type: "web_search_20260318", name: "web_search", max_uses: 6, user_location: { type: "approximate", country: "US" } },
        { type: "web_fetch_20260318", name: "web_fetch", max_uses: 6, max_content_tokens: 15000 },
      ],
    });
    const parsed = extractJson(text);
    if (!parsed) return res.status(502).json({ error: "Couldn't read the verification result.", raw: text.slice(-800), usage });
    return res.status(200).json({ ...normalizeVerify(parsed), usage, model: MODEL });
  } catch (e) {
    return res.status(e.status && e.status < 500 ? 502 : 500).json({ error: e.message || "Unexpected error." });
  }
}
