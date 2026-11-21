# Comp Check relay

Tiny Vercel functions that let the Comp Check page ask Claude to find and verify sold comps, and share saved checks across the team.

Environment variables (Vercel → Settings → Environment Variables):
- ANTHROPIC_API_KEY: your sk-ant-... key
- TEAM_PASSWORD: password your team types into Comp Check
- BLOB_READ_WRITE_TOKEN: added automatically by the connected Blob store `comp-check-saved` (private)
- CLAUDE_MODEL (optional): defaults to claude-sonnet-5-5

Endpoints (all POST with the X-Team-Password header; GET returns a health check):
- /api/comps: find sold comps
- /api/verify: verify one comp's sale
- /api/arv: re-estimate ARV from the ticked comps
- /api/checks: saved checks, `{action: "list" | "get" | "save" | "delete"}`. One record per subject address; saving again updates it and keeps a history of who saved when. A save is refused with 409 if a teammate saved a newer version since you opened it, unless `force` is set.
