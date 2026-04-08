# Open Brain — MCP Server HTTP Transport Refactor

## Context

Open Brain is a personal memory system. The MCP server exposes three tools
(`search_memory`, `store_memory`, `list_recent`) to MCP clients including
Claude Desktop, ChatGPT, and Slack. The server currently uses `StdioServerTransport`,
which is a local pipe — incompatible with Docker and EKS deployment.

This branch (`docker-mcp`) refactors the MCP server to use
`StreamableHTTPServerTransport` so it can run as a containerized service
reachable over HTTP from any MCP client.

---

## Repository structure
open-brain/
├── mcp-server.js          ← refactor target (stdio → HTTP transport)
├── capture-server.js      ← leave untouched in this branch
├── package.json           ← express already present, no new deps needed
├── .env.example           ← env var reference
├── .env                   ← local secrets (gitignored)
└── supabase/              ← Supabase Edge Function source

---

## Task: refactor mcp-server.js to HTTP transport

### What to change

Replace the stdio transport with `StreamableHTTPServerTransport` served via
Express. The server must:

1. **Import** `StreamableHTTPServerTransport` from
   `@modelcontextprotocol/sdk/server/streamableHttp.js` instead of
   `StdioServerTransport` from stdio.

2. **Use Express** (already in package.json) to handle MCP protocol over
   HTTP on `POST /mcp` and `GET /mcp`.

3. **Expose port** via `PORT` env var, defaulting to `3000`.

4. **Move hardcoded `SUPABASE_URL`** out of source into `process.env.SUPABASE_URL`.
   Update `.env.example` to include `SUPABASE_URL`.

5. **Preserve all three tools exactly** — `search_memory`, `store_memory`,
   `list_recent`. No logic changes, only transport changes.

6. **Add `GET /health`** returning `{ status: "ok" }` for Kubernetes liveness probes.

7. **Add a `start` script** to `package.json`: `"start": "node mcp-server.js"`

### Correct transport pattern
```javascript
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const app = express();
app.use(express.json());

const transport = new StreamableHTTPServerTransport({ path: '/mcp' });
await server.connect(transport);

app.use('/mcp', transport.requestHandler());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`open-brain MCP server listening on :${PORT}`));
```

> Verify the exact import path against the installed SDK version in node_modules
> before writing final code. SDK is at v1.27.x — check
> `node_modules/@modelcontextprotocol/sdk/server/` for the actual filename.

---

## Local test procedure (before touching Docker)

### 1. Start server
```bash
npm install
node mcp-server.js
# expect: open-brain MCP server listening on :3000
```

### 2. Health check
```bash
curl http://localhost:3000/health
# expect: {"status":"ok"}
```

### 3. MCP tools list
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# expect: search_memory, store_memory, list_recent
```

### 4. Update Claude Desktop config
```json
{
  "mcpServers": {
    "open-brain": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```
Restart Claude Desktop and confirm tools appear.

### 5. End-to-end test
Store: *"Store a test memory: HTTP transport is working."*
Retrieve: *"Search my memory for HTTP transport."*
Confirm the memory is returned.

---

## Definition of done for this branch

- [ ] `mcp-server.js` uses `StreamableHTTPServerTransport`, no stdio references
- [ ] `SUPABASE_URL` read from `process.env.SUPABASE_URL`
- [ ] `.env.example` includes `SUPABASE_URL` and `PORT`
- [ ] `GET /health` returns `{ status: "ok" }`
- [ ] `npm start` starts the server on port 3000
- [ ] Health check curl passes
- [ ] MCP tools/list curl returns all three tools
- [ ] Claude Desktop connects via URL, all three tools work end-to-end

---

## What comes next (not this branch)

Once all definition-of-done items are checked:
1. `Dockerfile` for mcp-server (Node.js 20 Alpine)
2. `docker-compose.yml` for local container testing
3. ECR image push
4. EKS Deployment + Service manifests
5. ALB Ingress for external HTTPS access

**Do not proceed to Docker until local HTTP transport is fully verified.**

---

## Environment variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_KEY` | Supabase anon/service key | Yes |
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `PORT` | HTTP listen port (default: 3000) | No |

In Docker: passed via `--env-file` or Kubernetes Secrets.
In local dev: `.env` loaded by dotenv.
