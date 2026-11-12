# Comp Check relay

Tiny Vercel function that lets the Comp Check page ask Claude to find sold comps.

Environment variables (Vercel → Settings → Environment Variables):
- ANTHROPIC_API_KEY: your sk-ant-... key
- TEAM_PASSWORD: password your team types into Comp Check
- CLAUDE_MODEL (optional): defaults to claude-sonnet-5-5

Endpoint: POST /api/comps   (GET /api/comps returns a health check)
