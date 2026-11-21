// Saved checks: lets one underwriter save a whole Comp Check and a teammate open it exactly as it was left.
// Stored in a private Vercel Blob store. Each subject address has one record that later saves overwrite,
// with a short history of who saved it and when. No Claude calls, so this costs nothing per use.
import { put, get, list, del } from "@vercel/blob";
import { gate, clean, num } from "../lib/claude.js";

const MAX_BYTES = 2_000_000;
const HISTORY = 25;

// One record per subject property, keyed by its normalized address.
export const checkId = (address) =>
  String(address || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);

async function readJson(pathname) {
  const r = await get(pathname, { access: "private", useCache: false });
  if (!r || !r.stream) return null;
  try { return JSON.parse(await new Response(r.stream).text()); } catch { return null; }
}
const writeJson = (pathname, data) =>
  put(pathname, JSON.stringify(data), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

function summarize(id, check, prev, by, note) {
  const st = check.state || {};
  const comps = Array.isArray(st.comps) ? st.comps : [];
  const now = new Date().toISOString();
  const arv = check.summary || {};
  const entry = { by, at: now, arv: num(arv.arv), note };
  return {
    id,
    address: clean(st.subject && st.subject.address, 200),
    savedBy: by,
    savedAt: now,
    note,
    createdBy: (prev && prev.createdBy) || by,
    createdAt: (prev && prev.createdAt) || now,
    compCount: comps.length,
    usedCount: num(arv.usedCount),
    arv: num(arv.arv),
    claudeArv: num(arv.claudeArv),
    history: [entry, ...((prev && prev.history) || [])].slice(0, HISTORY),
  };
}

export default async function handler(req, res) {
  const body = gate(req, res);
  if (!body) return;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: "Saved checks aren't set up yet: connect a Blob store to the relay in Vercel." });
  }
  try {
    const action = body.action;

    if (action === "list") {
      const blobs = await listAll("meta/");
      const metas = (await Promise.all(blobs.map((b) => readJson(b.pathname)))).filter(Boolean);
      metas.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      return res.status(200).json({ checks: metas.map(({ history, ...m }) => ({ ...m, saves: (history || []).length })) });
    }

    if (action === "get") {
      const id = checkId(body.id);
      if (!id) return res.status(400).json({ error: "Missing check id." });
      const [check, meta] = await Promise.all([readJson(`checks/${id}.json`), readJson(`meta/${id}.json`)]);
      if (!check) return res.status(404).json({ error: "That saved check is gone. Someone may have deleted it." });
      return res.status(200).json({ check, meta });
    }

    if (action === "save") {
      const check = body.check;
      const address = check && check.state && check.state.subject && check.state.subject.address;
      if (!address) return res.status(400).json({ error: "Set a subject property before saving." });
      const by = clean(body.savedBy, 60).trim();
      if (!by) return res.status(400).json({ error: "Enter your name so your teammate knows who saved it." });
      const id = checkId(address);
      const raw = JSON.stringify(check);
      if (raw.length > MAX_BYTES) return res.status(413).json({ error: "This check is too large to save." });
      const prev = await readJson(`meta/${id}.json`);
      // Don't silently overwrite a teammate's newer save of the same property.
      if (prev && !body.force && (body.baseSavedAt || null) !== prev.savedAt) {
        return res.status(409).json({ error: "newer", meta: { savedBy: prev.savedBy, savedAt: prev.savedAt } });
      }
      const meta = summarize(id, check, prev, by, clean(body.note, 200).trim());
      await writeJson(`checks/${id}.json`, { ...check, savedBy: by, savedAt: meta.savedAt });
      await writeJson(`meta/${id}.json`, meta);
      return res.status(200).json({ ok: true, meta });
    }

    if (action === "delete") {
      const id = checkId(body.id);
      if (!id) return res.status(400).json({ error: "Missing check id." });
      const blobs = [...(await listAll(`checks/${id}.json`)), ...(await listAll(`meta/${id}.json`))];
      if (blobs.length) await del(blobs.map((b) => b.url));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Saved checks error." });
  }
}
