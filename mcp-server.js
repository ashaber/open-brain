import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });
const SUPABASE_URL = "https://xkbmtdalqtfmabvqymxv.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getEmbedding(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: text, model: "text-embedding-3-small" }),
  });
  const json = await res.json();
  return json.data[0].embedding;
}

const server = new McpServer({ name: "open-brain", version: "1.0.0" });

server.tool(
  "search_memory",
  "Search your personal memory by meaning. Use this to find past thoughts, decisions, people, and context.",
  { query: z.string(), limit: z.number().optional() },
  async ({ query, limit = 10 }) => {
    const embedding = await getEmbedding(query);
    const { data, error } = await supabase.rpc("match_memories", {
      query_embedding: embedding,
      match_threshold: 0.5,
      match_count: limit,
    });
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    if (!data?.length) return { content: [{ type: "text", text: "No memories found." }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "store_memory",
  "Store a new memory or thought into your personal knowledge base.",
  { content: z.string(), source: z.string().optional() },
  async ({ content, source = "claude" }) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/capture-memory`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, source }),
    });
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
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
