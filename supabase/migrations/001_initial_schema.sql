create extension if not exists vector;

create table memories (
  id bigserial primary key,
  content text not null,
  embedding vector(1536),
  metadata jsonb,
  source text,
  created_at timestamptz default now()
);

create index on memories
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);
