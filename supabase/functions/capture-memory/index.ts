import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const { content, source } = await req.json();

  // 1. Get embedding
  const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: content, model: "text-embedding-3-small" }),
  });

  const embeddingJson = await embeddingRes.json();
  
  // Log the full response so we can see what's coming back
  console.log("OpenAI embedding response:", JSON.stringify(embeddingJson));

  if (!embeddingJson.data) {
    return new Response(JSON.stringify({ 
      error: "Embedding failed", 
      detail: embeddingJson 
    }), { status: 500 });
  }

  const embedding = embeddingJson.data[0].embedding;

  // 2. Extract metadata
  const metaRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Extract metadata from this note as JSON only. Fields: people (array), topics (array), type (decision|insight|person|meeting|task|other), action_items (array). Note: "${content}"`
      }],
      response_format: { type: "json_object" }
    }),
  });

  const metaJson = await metaRes.json();
  console.log("OpenAI metadata response:", JSON.stringify(metaJson));

  if (!metaJson.choices) {
    return new Response(JSON.stringify({ 
      error: "Metadata extraction failed", 
      detail: metaJson 
    }), { status: 500 });
  }

  const metadata = JSON.parse(metaJson.choices[0].message.content);

  // 3. Store
  const { error } = await supabase.from("memories").insert({
    content,
    embedding,
    metadata,
    source: source ?? "manual",
  });

  if (error) return new Response(JSON.stringify({ error }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, metadata }), { status: 200 });
});
