# swarm-mail

```
                                _.------._
                               .'   .--.   '.        🐝
                              /   .'    '.   \    🐝
                             |   /   __   \   |      🐝
       🐝                    |  |   (  )   |  |  🐝
            🐝    _  _       |  |   |__|   |  |
                 ( \/ )       \  '.      .'  /    🐝
       🐝    ____/    \____    '.  '----'  .'
           /    \    /    \     '-._____.-'           🐝
          /  ()  \  /  ()  \
         |   /\   ||   /\   |     ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
         |  /__\  ||  /__\  |     ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
          \      /  \      /      ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
       🐝  '----'    '----'       ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
                                  ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
             🐝                   ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
                    🐝
       🐝                         ███╗   ███╗ █████╗ ██╗██╗
                                  ████╗ ████║██╔══██╗██║██║         🐝
            🐝                    ██╔████╔██║███████║██║██║
                                  ██║╚██╔╝██║██╔══██║██║██║    🐝
       🐝        🐝               ██║ ╚═╝ ██║██║  ██║██║███████╗
                                  ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝       🐝
                 🐝
                             ⚡ Actor-Model Primitives for Agent Coordination ⚡
```

Event sourcing primitives for multi-agent coordination. Local-first, no external servers.

**[🌐 swarmtools.ai](https://swarmtools.ai)** | **[📖 Full Documentation](https://swarmtools.ai/docs)**

```
┌─────────────────────────────────────────────────────────────┐
│                     SWARM MAIL STACK                        │
├─────────────────────────────────────────────────────────────┤
│  TIER 3: COORDINATION                                       │
│  └── ask<Req, Res>() - Request/Response (RPC-style)        │
│                                                             │
│  TIER 2: PATTERNS                                           │
│  ├── DurableMailbox - Actor inbox with typed envelopes     │
│  └── DurableLock - CAS-based mutual exclusion              │
│                                                             │
│  TIER 1: PRIMITIVES                                         │
│  ├── DurableCursor - Checkpointed stream reader            │
│  └── DurableDeferred - Distributed promise                 │
│                                                             │
│  MEMORY                                                     │
│  └── Semantic Memory - Vector embeddings (pgvector/Ollama) │
│                                                             │
│  STORAGE                                                    │
│  └── PGLite (Embedded Postgres) + Migrations               │
└─────────────────────────────────────────────────────────────┘
```

## Install

```bash
bun add swarm-mail
```

## Usage

### Event Store

Append-only event log with automatic projection updates:

```typescript
import { getSwarmMail } from "swarm-mail";

// Create swarm mail instance (automatically creates PGlite adapter)
const swarmMail = await getSwarmMail("/my/project");

// Append events
await swarmMail.appendEvent({
  type: "agent_registered",
  agent_name: "WorkerA",
  task_description: "Implementing auth",
  timestamp: Date.now(),
});

// Query projections
const agents = await swarmMail.getAgents();
const messages = await swarmMail.getInbox("WorkerA", { limit: 5 });
```

### Durable Primitives (Effect-TS)

Built on Effect-TS for type-safe, composable coordination:

```typescript
import { DurableMailbox, DurableLock, ask } from 'swarm-mail'
import { Effect } from 'effect'

// Actor mailbox
const mailbox = DurableMailbox.create<MyMessage>('worker-a')
await Effect.runPromise(
  mailbox.send({ type: 'task', payload: 'do something' })
)

// File locking
const lock = DurableLock.create('src/auth.ts')
await Effect.runPromise(
  lock.acquire({ ttl: 60000 }).pipe(
    Effect.flatMap(() => /* do work */),
    Effect.ensuring(lock.release())
  )
)

// Request/response
const response = await Effect.runPromise(
  ask<Request, Response>('other-agent', { type: 'get-types' })
)
```

### Database Adapter

Dependency injection for testing and flexibility:

```typescript
import { DatabaseAdapter, createSwarmMailAdapter } from 'swarm-mail'

// Implement your own adapter
const customAdapter: DatabaseAdapter = {
  query: async (sql, params) => /* ... */,
  exec: async (sql) => /* ... */,
  transaction: async (fn) => /* ... */,
  close: async () => /* ... */
}

// Use custom adapter
const swarmMail = createSwarmMailAdapter(customAdapter, '/my/project')

// Or use the convenience layer (built-in PGLite)
import { getSwarmMail, createInMemorySwarmMail } from 'swarm-mail'
const swarmMail = await getSwarmMail('/my/project') // persistent
const swarmMail = await createInMemorySwarmMail() // in-memory
```

## Deployment

### Connection Modes

#### Daemon Mode (Default)

By default, swarm-mail starts an in-process `PGLiteSocketServer` when you call `getSwarmMail()`. All database operations go through this server, preventing multi-process corruption.

```typescript
import { getSwarmMail } from 'swarm-mail'

// Default: starts daemon automatically
const swarmMail = await getSwarmMail('/my/project')

// Keep alive - handles cleanup on shutdown
process.on('SIGTERM', async () => {
  await swarmMail.close() // Flushes WAL, closes cleanly
  process.exit(0)
})
```

**Why daemon mode is the default:**

- **No external dependencies** - Uses `@electric-sql/pglite-socket` in-process
- **Multi-process safe** - One PGLite instance, multiple clients can connect safely
- **WAL safety** - Single process prevents WAL accumulation from multiple instances
- **Proper cleanup** - Graceful shutdown triggers checkpoint, preventing unclean state
- **Resource efficiency** - One PGLite instance shared across operations

#### Embedded Mode (Opt-out)

For single-process use cases where you're certain only one process will access the database, you can opt out of daemon mode:

```bash
SWARM_MAIL_SOCKET=false
```

⚠️ **Warning:** Embedded mode is NOT safe for multi-process access. PGLite uses a single connection, so concurrent processes will cause database corruption. Use only when you're absolutely certain only one process will access the database

### WAL Safety Features

PGLite uses PostgreSQL's Write-Ahead Log (WAL) for durability. Swarm Mail includes safeguards against WAL bloat:

**Automatic checkpointing:**
```typescript
// After batch operations, force WAL flush
await db.checkpoint()
```

**Health monitoring:**
```typescript
// Check WAL size (default threshold: 100MB)
const health = await swarmMail.healthCheck({ walThresholdMb: 100 })

if (!health.walHealth?.healthy) {
  console.warn(health.walHealth?.message)
  // "WAL size 120MB exceeds 100MB threshold (15 files)"
}

// Get detailed stats
const stats = await swarmMail.getDatabaseStats()
// { connected: true, wal: { size: 120_000_000, fileCount: 15 } }
```

**When to checkpoint manually:**

- After migrations: `await swarmMail.runMigrations(); await db.checkpoint()`
- After bulk event appends (100+ events)
- Before long-running operations

### Ephemeral Instances (Testing)

For tests, create isolated in-memory instances:

```typescript
import { createInMemorySwarmMail } from 'swarm-mail'

const swarmMail = await createInMemorySwarmMail('test-id')
// ... run tests ...
await swarmMail.close()
```

**Don't use ephemeral instances in production** - multiple short-lived processes compound WAL accumulation since each instance creates new PGLite connections without coordinated cleanup.

## Event Types

```typescript
type SwarmMailEvent =
  | { type: "agent_registered"; agent_name: string; task_description?: string }
  | {
      type: "message_sent";
      from: string;
      to: string[];
      subject: string;
      body: string;
    }
  | { type: "message_read"; message_id: number; agent_name: string }
  | {
      type: "file_reserved";
      agent_name: string;
      paths: string[];
      exclusive: boolean;
    }
  | { type: "file_released"; agent_name: string; paths: string[] }
  | {
      type: "swarm_checkpointed";
      epic_id: string;
      progress: number;
      state: object;
    }
  | { type: "decomposition_generated"; epic_id: string; subtasks: object[] }
  | {
      type: "subtask_outcome";
      bead_id: string;
      success: boolean;
      duration_ms: number;
    };
```

## Projections

Materialized views derived from events:

| Projection          | Description                        |
| ------------------- | ---------------------------------- |
| `agents`            | Active agents per project          |
| `messages`          | Agent inbox/outbox with recipients |
| `file_reservations` | Current file locks with TTL        |
| `swarm_contexts`    | Checkpoint state for recovery      |
| `eval_records`      | Outcome data for learning          |

### Semantic Memory

Persistent, searchable storage for agent learnings:

```typescript
import { createMemoryAdapter } from 'swarm-mail/memory'

const swarmMail = await getSwarmMail('/my/project')
const db = await swarmMail.getDatabase()
const memory = await createMemoryAdapter(db)

// Store a learning
const { id } = await memory.store(
  "OAuth refresh tokens need 5min buffer before expiry...",
  { tags: "auth,tokens,debugging" }
)

// Search by meaning (vector similarity)
const results = await memory.find("token refresh issues")

// Check Ollama health
const health = await memory.checkHealth()
// { ollama: true, model: "mxbai-embed-large" }
```

> **Note:** Requires [Ollama](https://ollama.ai/) for vector embeddings. Falls back to full-text search if unavailable.
>
> ```bash
> ollama pull mxbai-embed-large
> ```

> **Deprecation Notice:** The standalone [semantic-memory MCP server](https://github.com/joelhooks/semantic-memory) is deprecated. Use the embedded memory in swarm-mail instead - same API, single PGLite instance, no separate process.

## Architecture

- **Append-only log** - Events are immutable, projections are derived
- **Local-first** - PGLite embedded Postgres, no external servers
- **Effect-TS** - Type-safe, composable, testable
- **Exactly-once** - DurableCursor checkpoints position
- **Semantic memory** - Vector embeddings with pgvector + Ollama

## API Reference

For complete API documentation, see [swarmtools.ai/docs](https://swarmtools.ai/docs).

### SwarmMailAdapter

```typescript
interface SwarmMailAdapter {
  // Events
  appendEvent(event: SwarmMailEvent): Promise<{ id: number; sequence: number }>;
  getEvents(options?: {
    limit?: number;
    after?: number;
  }): Promise<StoredEvent[]>;

  // Agents
  getAgents(): Promise<Agent[]>;
  getAgent(name: string): Promise<Agent | null>;

  // Messages
  getInbox(agent: string, options?: InboxOptions): Promise<Message[]>;
  getMessage(id: number): Promise<Message | null>;
  getThread(threadId: string): Promise<Message[]>;

  // Reservations
  getReservations(): Promise<Reservation[]>;
  getReservationsForAgent(agent: string): Promise<Reservation[]>;
  checkConflicts(paths: string[], excludeAgent?: string): Promise<Conflict[]>;

  // Swarm Context
  getSwarmContext(epicId: string): Promise<SwarmContext | null>;

  // Debug
  debugEvents(options?: DebugOptions): Promise<DebugEvent[]>;
  debugAgent(name: string): Promise<AgentDebugInfo>;
}
```

## License

MIT
