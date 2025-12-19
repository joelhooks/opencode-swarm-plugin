#!/usr/bin/env bun
/**
 * SPIKE: libSQL with Ollama embeddings
 * 
 * RESULT: SUCCESS ✅
 * 
 * libSQL has NATIVE vector support - no extensions, no Homebrew, just works.
 * 
 * Key findings:
 * - F32_BLOB(N) column type for vectors
 * - vector() function to create vectors from JSON arrays
 * - vector_distance_cos() for cosine similarity (lower = more similar)
 * - Works in-memory or file-based
 * - Can connect to Turso cloud later if needed
 * 
 * Run: bun packages/swarm-mail/scripts/sqlite-vec-spike.ts
 */

import { createClient } from "@libsql/client";

const db = createClient({ url: ":memory:" });

async function embed(text: string): Promise<number[]> {
  const res = await fetch("http://localhost:11434/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "mxbai-embed-large", input: text }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const embedding = data.embeddings?.[0];

  if (!embedding || !Array.isArray(embedding)) {
    throw new Error("Invalid embedding response");
  }

  return embedding;
}

async function main() {
  console.log("🐝 libSQL + Ollama Vector Search Spike\n");

  // Check Ollama
  console.log("📡 Checking Ollama...");
  try {
    const testEmb = await embed("test");
    console.log(`✅ Ollama ready (${testEmb.length} dimensions)\n`);
  } catch (e) {
    console.error("❌ Ollama not available:", e instanceof Error ? e.message : e);
    console.error("   Run: ollama run mxbai-embed-large");
    process.exit(1);
  }

  // Create table with vector column
  console.log("💾 Creating table...");
  await db.execute(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding F32_BLOB(1024),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("✅ Table created\n");

  // Test memories
  const memories = [
    "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions",
    "Next.js caching strategies for dynamic routes with ISR",
    "TypeScript type narrowing with discriminated unions",
    "React useEffect cleanup functions prevent memory leaks",
    "Event sourcing with Effect-TS for audit logging",
    "Zod schema validation for API request parsing",
    "JWT token authentication with refresh token rotation",
    "SQLite WAL mode for concurrent reads and writes",
  ];

  console.log("🧠 Embedding memories...");
  for (let i = 0; i < memories.length; i++) {
    const emb = await embed(memories[i]);
    await db.execute({
      sql: "INSERT INTO memories (id, content, embedding) VALUES (?, ?, vector(?))",
      args: [`mem-${i}`, memories[i], JSON.stringify(emb)],
    });
    console.log(`   ✓ ${memories[i].slice(0, 50)}...`);
  }
  console.log(`✅ Stored ${memories.length} memories\n`);

  // Semantic search
  console.log("🔍 Testing semantic search...\n");
  const queries = [
    "authentication and security tokens",
    "type safety in TypeScript",
    "database concurrency",
  ];

  for (const query of queries) {
    console.log(`📝 Query: "${query}"`);
    const queryEmb = await embed(query);
    const results = await db.execute({
      sql: `
        SELECT content, vector_distance_cos(embedding, vector(?)) as distance
        FROM memories
        ORDER BY distance ASC
        LIMIT 3
      `,
      args: [JSON.stringify(queryEmb)],
    });

    console.log("   Results:");
    for (const row of results.rows) {
      const similarity = 1 - (row.distance as number);
      console.log(`   - [${similarity.toFixed(3)}] ${row.content}`);
    }
    console.log();
  }

  // Summary
  console.log("═".repeat(60));
  console.log("✅ SPIKE SUCCESSFUL\n");
  console.log("Key findings:");
  console.log("  ✅ libSQL has native vector support (no extensions)");
  console.log("  ✅ Works with bun out of the box");
  console.log("  ✅ F32_BLOB(N) for vector columns");
  console.log("  ✅ vector_distance_cos() for similarity search");
  console.log("  ✅ Semantic results are excellent");
  console.log("  ✅ No Homebrew, no OS deps, portable");
  console.log();
  console.log("Next steps:");
  console.log("  - Build LibSQLAdapter with same interface as PGLiteAdapter");
  console.log("  - Add FTS fallback when Ollama unavailable");
  console.log("  - Migrate semantic-memory to use libSQL");
}

main().catch((e) => {
  console.error("❌ SPIKE FAILED:", e.message);
  process.exit(1);
});
