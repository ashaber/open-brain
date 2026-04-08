import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import express from 'express';

// Simple structured logger — writes JSON to stdout
const log = {
  info:  (msg, meta = {}) => console.log(JSON.stringify({ level: 'info',  msg, ...meta, ts: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', msg, ...meta, ts: new Date().toISOString() })),
  warn:  (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn',  msg, ...meta, ts: new Date().toISOString() })),
};

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_API_KEY) {
  log.error('missing required environment variables', {
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_KEY: !!SUPABASE_KEY,
    OPENAI_API_KEY: !!OPENAI_API_KEY,
  });
  process.exit(1);
}

let supabase;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  log.info('supabase client initialised', { url: SUPABASE_URL });
} catch (err) {
  log.error('failed to initialise supabase client', { error: err.message });
  process.exit(1);
}

async function getEmbedding(text) {
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: text, model: "text-embedding-3-small" }),
    });
  } catch (err) {
    log.error('openai embeddings request failed', { error: err.message });
    throw err;
  }
  if (!res.ok) {
    const body = await res.text();
    log.error('openai embeddings returned error status', { status: res.status, body });
    throw new Error(`OpenAI embeddings error ${res.status}: ${body}`);
  }
  const json = await res.json();
  return json.data[0].embedding;
}

// The SDK requires a fresh McpServer + transport per request in stateless mode.
// Tool handlers close over shared clients (supabase, env vars) so no logic moves.
function createMcpServer() {
  const server = new McpServer({ name: "open-brain", version: "1.0.0" });

  server.tool(
    "search_memory",
    "Search your personal memory by meaning. Use this to find past thoughts, decisions, people, and context.",
    { query: z.string(), limit: z.number().optional() },
    async ({ query, limit = 10 }) => {
      let embedding;
      try {
        embedding = await getEmbedding(query);
      } catch (err) {
        return { content: [{ type: "text", text: `Error getting embedding: ${err.message}` }] };
      }
      const { data, error } = await supabase.rpc("match_memories", {
        query_embedding: embedding,
        match_threshold: 0.5,
        match_count: limit,
      });
      if (error) {
        log.error('supabase match_memories failed', { error: error.message });
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
      if (!data?.length) return { content: [{ type: "text", text: "No memories found." }] };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "store_memory",
    "Store a new memory or thought into your personal knowledge base.",
    { content: z.string(), source: z.string().optional() },
    async ({ content, source = "claude" }) => {
      let res;
      try {
        res = await fetch(`${SUPABASE_URL}/functions/v1/capture-memory`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content, source }),
        });
      } catch (err) {
        log.error('capture-memory request failed', { error: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }] };
      }
      if (!res.ok) {
        const body = await res.text();
        log.error('capture-memory returned error status', { status: res.status, body });
        return { content: [{ type: "text", text: `Error ${res.status}: ${body}` }] };
      }
      const json = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(json) }] };
    }
  );

  server.tool(
    "list_recent",
    "List memories captured in the last N days.",
    { days: z.number().optional() },
    async ({ days = 7 }) => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await supabase
        .from("memories")
        .select("id, content, metadata, source, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      if (error) {
        log.error('supabase list_recent failed', { error: error.message });
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.use('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log.error('MCP handleRequest error', { error: err.message });
    if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally {
    await server.close().catch(() => {});
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  log.error('unhandled express error', { error: err.message });
  if (!res.headersSent) res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT ?? 3000;
const httpServer = app.listen(PORT, () => log.info('server started', { port: PORT }));

function shutdown(signal) {
  log.info('server stopping', { signal });
  httpServer.close(() => log.info('server stopped'));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
