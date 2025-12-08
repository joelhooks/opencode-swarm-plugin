"""
Minimal Agent Mail Server for Integration Testing

A lightweight MCP-compatible server that provides multi-agent coordination
capabilities: messaging, file reservations, and project management.

This is NOT the production Agent Mail server - it's a minimal implementation
for testing the opencode-swarm-plugin MCP client.
"""

import random
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# =============================================================================
# Configuration
# =============================================================================

DB_PATH = Path("/data/agentmail.db")

# Agent name generation wordlists
ADJECTIVES = [
    "Blue", "Red", "Green", "Golden", "Silver", "Crystal", "Shadow", "Bright",
    "Swift", "Silent", "Bold", "Calm", "Wild", "Noble", "Frost", "Storm",
    "Dawn", "Dusk", "Iron", "Copper", "Azure", "Crimson", "Amber", "Jade",
    "Coral", "Misty", "Sunny", "Lunar", "Solar", "Cosmic", "Terra", "Aqua",
]

NOUNS = [
    "Lake", "Stone", "River", "Mountain", "Forest", "Valley", "Meadow", "Peak",
    "Canyon", "Desert", "Ocean", "Island", "Prairie", "Grove", "Creek", "Ridge",
    "Harbor", "Cliff", "Glacier", "Dune", "Marsh", "Brook", "Hill", "Plain",
    "Bay", "Cape", "Delta", "Fjord", "Mesa", "Plateau", "Reef", "Tundra",
]

# =============================================================================
# Database Setup
# =============================================================================

def init_db():
    """Initialize SQLite database with required tables."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    
    conn.executescript("""
        -- Projects table
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            human_key TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        
        -- Agents table
        CREATE TABLE IF NOT EXISTS agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            program TEXT NOT NULL,
            model TEXT NOT NULL,
            task_description TEXT,
            inception_ts TEXT NOT NULL DEFAULT (datetime('now')),
            last_active_ts TEXT NOT NULL DEFAULT (datetime('now')),
            project_id INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            UNIQUE (name, project_id)
        );
        
        -- Messages table
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            sender_id INTEGER NOT NULL,
            subject TEXT NOT NULL,
            body_md TEXT,
            thread_id TEXT,
            importance TEXT DEFAULT 'normal',
            ack_required INTEGER DEFAULT 0,
            kind TEXT DEFAULT 'message',
            created_ts TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (sender_id) REFERENCES agents(id)
        );
        
        -- Message recipients table (many-to-many)
        CREATE TABLE IF NOT EXISTS message_recipients (
            message_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            read_at TEXT,
            acked_at TEXT,
            PRIMARY KEY (message_id, agent_id),
            FOREIGN KEY (message_id) REFERENCES messages(id),
            FOREIGN KEY (agent_id) REFERENCES agents(id)
        );
        
        -- File reservations table
        CREATE TABLE IF NOT EXISTS file_reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            path_pattern TEXT NOT NULL,
            exclusive INTEGER DEFAULT 1,
            reason TEXT,
            created_ts TEXT NOT NULL DEFAULT (datetime('now')),
            expires_ts TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (agent_id) REFERENCES agents(id)
        );
        
        -- Full-text search for messages
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            subject, body_md, content='messages', content_rowid='id'
        );
        
        -- Triggers to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, subject, body_md) 
            VALUES (new.id, new.subject, new.body_md);
        END;
        
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, subject, body_md) 
            VALUES ('delete', old.id, old.subject, old.body_md);
        END;
        
        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, subject, body_md) 
            VALUES ('delete', old.id, old.subject, old.body_md);
            INSERT INTO messages_fts(rowid, subject, body_md) 
            VALUES (new.id, new.subject, new.body_md);
        END;
    """)
    
    conn.commit()
    conn.close()


@contextmanager
def get_db():
    """Get database connection with row factory."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def generate_agent_name() -> str:
    """Generate a random adjective+noun agent name."""
    return f"{random.choice(ADJECTIVES)}{random.choice(NOUNS)}"


def generate_slug(human_key: str) -> str:
    """Generate a URL-safe slug from a human key."""
    # Simple slug: replace path separators and special chars
    slug = human_key.replace("/", "_").replace("\\", "_").replace(" ", "_")
    slug = "".join(c for c in slug if c.isalnum() or c == "_")
    return slug.lower()[:64]


def now_iso() -> str:
    """Get current time in ISO format."""
    return datetime.now(timezone.utc).isoformat()


# =============================================================================
# FastAPI App
# =============================================================================

app = FastAPI(title="Agent Mail Test Server", version="0.1.0")


@app.on_event("startup")
async def startup():
    """Initialize database on startup."""
    init_db()


# =============================================================================
# Health Endpoints
# =============================================================================

@app.get("/health/liveness")
async def health_liveness():
    """Liveness check for container health."""
    return {"status": "ok", "timestamp": now_iso()}


@app.get("/health/readiness")
async def health_readiness():
    """Readiness check - verify database is accessible."""
    try:
        with get_db() as conn:
            conn.execute("SELECT 1")
        return {"status": "ready", "timestamp": now_iso()}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


# =============================================================================
# MCP JSON-RPC Endpoint
# =============================================================================

class MCPRequest(BaseModel):
    """MCP JSON-RPC request format."""
    jsonrpc: str = "2.0"
    id: str
    method: str
    params: dict[str, Any] = {}


class MCPError(BaseModel):
    """MCP JSON-RPC error format."""
    code: int
    message: str
    data: Any = None


class MCPResponse(BaseModel):
    """MCP JSON-RPC response format."""
    jsonrpc: str = "2.0"
    id: str
    result: Any = None
    error: MCPError | None = None


@app.post("/mcp/")
async def mcp_endpoint(request: MCPRequest):
    """
    MCP JSON-RPC endpoint.
    
    Handles tools/call method for Agent Mail operations.
    """
    if request.method != "tools/call":
        return MCPResponse(
            id=request.id,
            error=MCPError(
                code=-32601,
                message=f"Method not found: {request.method}",
            )
        )
    
    tool_name = request.params.get("name", "")
    arguments = request.params.get("arguments", {})
    
    try:
        result = await dispatch_tool(tool_name, arguments)
        return MCPResponse(id=request.id, result=result)
    except ValueError as e:
        return MCPResponse(
            id=request.id,
            error=MCPError(code=-32602, message=str(e))
        )
    except Exception as e:
        return MCPResponse(
            id=request.id,
            error=MCPError(code=-32000, message=str(e))
        )


# =============================================================================
# Tool Dispatcher
# =============================================================================

async def dispatch_tool(name: str, args: dict[str, Any]) -> Any:
    """Dispatch tool call to appropriate handler."""
    tools = {
        "ensure_project": tool_ensure_project,
        "register_agent": tool_register_agent,
        "send_message": tool_send_message,
        "fetch_inbox": tool_fetch_inbox,
        "mark_message_read": tool_mark_message_read,
        "summarize_thread": tool_summarize_thread,
        "file_reservation_paths": tool_file_reservation_paths,
        "release_file_reservations": tool_release_file_reservations,
        "acknowledge_message": tool_acknowledge_message,
        "search_messages": tool_search_messages,
    }
    
    handler = tools.get(name)
    if not handler:
        raise ValueError(f"Unknown tool: {name}")
    
    return await handler(args)


# =============================================================================
# Tool Implementations
# =============================================================================

async def tool_ensure_project(args: dict[str, Any]) -> dict:
    """Create or get a project by human_key."""
    human_key = args.get("human_key")
    if not human_key:
        raise ValueError("human_key is required")
    
    slug = generate_slug(human_key)
    
    with get_db() as conn:
        # Try to find existing project
        row = conn.execute(
            "SELECT * FROM projects WHERE human_key = ?",
            (human_key,)
        ).fetchone()
        
        if row:
            return dict(row)
        
        # Create new project
        cursor = conn.execute(
            "INSERT INTO projects (slug, human_key, created_at) VALUES (?, ?, ?)",
            (slug, human_key, now_iso())
        )
        project_id = cursor.lastrowid
        
        row = conn.execute(
            "SELECT * FROM projects WHERE id = ?",
            (project_id,)
        ).fetchone()
        
        return dict(row)


async def tool_register_agent(args: dict[str, Any]) -> dict:
    """Register an agent with a project."""
    project_key = args.get("project_key")
    program = args.get("program", "unknown")
    model = args.get("model", "unknown")
    name = args.get("name")
    task_description = args.get("task_description", "")
    
    if not project_key:
        raise ValueError("project_key is required")
    
    with get_db() as conn:
        # Get project
        project = conn.execute(
            "SELECT * FROM projects WHERE human_key = ?",
            (project_key,)
        ).fetchone()
        
        if not project:
            raise ValueError(f"Project not found: {project_key}")
        
        project_id = project["id"]
        
        # Generate name if not provided
        if not name:
            # Keep trying until we get a unique name
            for _ in range(100):
                name = generate_agent_name()
                existing = conn.execute(
                    "SELECT id FROM agents WHERE name = ? AND project_id = ?",
                    (name, project_id)
                ).fetchone()
                if not existing:
                    break
            else:
                name = f"{generate_agent_name()}_{uuid.uuid4().hex[:4]}"
        
        # Check if agent already exists
        existing = conn.execute(
            "SELECT * FROM agents WHERE name = ? AND project_id = ?",
            (name, project_id)
        ).fetchone()
        
        if existing:
            # Update last_active_ts
            conn.execute(
                "UPDATE agents SET last_active_ts = ? WHERE id = ?",
                (now_iso(), existing["id"])
            )
            return dict(existing)
        
        # Create new agent
        now = now_iso()
        cursor = conn.execute(
            """INSERT INTO agents 
               (name, program, model, task_description, inception_ts, last_active_ts, project_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (name, program, model, task_description, now, now, project_id)
        )
        agent_id = cursor.lastrowid
        
        row = conn.execute(
            "SELECT * FROM agents WHERE id = ?",
            (agent_id,)
        ).fetchone()
        
        return dict(row)


async def tool_send_message(args: dict[str, Any]) -> dict:
    """Send a message to other agents."""
    project_key = args.get("project_key")
    sender_name = args.get("sender_name")
    to = args.get("to", [])
    subject = args.get("subject", "")
    body_md = args.get("body_md", "")
    thread_id = args.get("thread_id")
    importance = args.get("importance", "normal")
    ack_required = args.get("ack_required", False)
    
    if not project_key:
        raise ValueError("project_key is required")
    if not sender_name:
        raise ValueError("sender_name is required")
    if not to:
        raise ValueError("to is required (list of recipient names)")
    
    with get_db() as conn:
        # Get project
        project = conn.execute(
            "SELECT * FROM projects WHERE human_key = ?",
            (project_key,)
        ).fetchone()
        if not project:
            raise ValueError(f"Project not found: {project_key}")
        
        project_id = project["id"]
        
        # Get sender agent
        sender = conn.execute(
            "SELECT * FROM agents WHERE name = ? AND project_id = ?",
            (sender_name, project_id)
        ).fetchone()
        if not sender:
            raise ValueError(f"Sender agent not found: {sender_name}")
        
        # Create message
        cursor = conn.execute(
            """INSERT INTO messages 
               (project_id, sender_id, subject, body_md, thread_id, importance, ack_required, created_ts)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (project_id, sender["id"], subject, body_md, thread_id, importance, 
             1 if ack_required else 0, now_iso())
        )
        message_id = cursor.lastrowid
        
        # Add recipients
        for recipient_name in to:
            recipient = conn.execute(
                "SELECT * FROM agents WHERE name = ? AND project_id = ?",
                (recipient_name, project_id)
            ).fetchone()
            
            if recipient:
                conn.execute(
                    "INSERT INTO message_recipients (message_id, agent_id) VALUES (?, ?)",
                    (message_id, recipient["id"])
                )
        
        return {
            "id": message_id,
            "subject": subject,
            "sent_to": to,
            "created_ts": now_iso(),
        }


async def tool_fetch_inbox(args: dict[str, Any]) -> list[dict]:
    """Fetch inbox messages for an agent."""
    project_key = args.get("project_key")
    agent_name = args.get("agent_name")
    limit = args.get("limit", 10)
    include_bodies = args.get("include_bodies", False)
    urgent_only = args.get("urgent_only", False)
    since_ts = args.get("since_ts")
    
    if not project_key:
        raise ValueError("project_key is required")
    if not agent_name:
        raise ValueError("agent_name is required")
    
    with get_db() as conn:
        # Get project and agent
        project = conn.execute(
            "SELECT * FROM projects WHERE human_key = ?",
            (project_key,)
        ).fetchone()
        if not project:
            raise ValueError(f"Project not found: {project_key}")
        
        agent = conn.execute(
            "SELECT * FROM agents WHERE name = ? AND project_id = ?",
            (agent_name, project["id"])
        ).fetchone()
        if not agent:
            raise ValueError(f"Agent not found: {agent_name}")
        
        # Build query
        query = """
            SELECT m.*, a.name as from_name
            FROM messages m
            JOIN message_recipients mr ON m.id = mr.message_id
            JOIN agents a ON m.sender_id = a.id
            WHERE mr.agent_id = ?
        """
        params: list[Any] = [agent["id"]]
        
        if urgent_only:
            query += " AND m.importance = 'urgent'"
        
        if since_ts:
            query += " AND m.created_ts > ?"
            params.append(since_ts)
        
        query += " ORDER BY m.created_ts DESC LIMIT ?"
        params.append(limit)
        
        rows = conn.execute(query, params).fetchall()
        
        messages = []
        for row in rows:
            msg = {
                "id": row["id"],
                "subject": row["subject"],
                "from": row["from_name"],
                "created_ts": row["created_ts"],
                "importance": row["importance"],
                "ack_required": bool(row["ack_required"]),
                "thread_id": row["thread_id"],
                "kind": row["kind"],
            }
            if include_bodies:
                msg["body_md"] = row["body_md"]
            messages.append(msg)
        
        return messages


async def tool_mark_message_read(args: dict[str, Any]) -> dict:
    """Mark a message as read."""
    project_key = args.get("project_key")
    agent_name = args.get("agent_name")
    message_id = args.get("message_id")
    
    if not all([project_key, agent_name, message_id]):
        raise ValueError("project_key, agent_name, and message_id are required")
    
    with get_db() as conn:
        # Get agent
        project = conn.execute(
            "SELECT * FROM projects WHERE human_key = ?",
            (project_key,)
        ).fetchone()
        if not project:
            raise ValueError(f"Project not found: {project_key}")
        
        agent = conn.execute(
            "SELECT * FROM agents WHERE name = ? AND project_id = ?",
            (agent_name, project["id"])
        ).fetchone()
        if not agent:
            raise ValueError(f"Agent not found: {agent_name}")
        
        # Update read timestamp
        conn.execute(
            """UPDATE message_recipients 
               SET read_at = ? 
               WHERE message_id = ? AND agent_id = ?""",
            (now_iso(), message_id, agent["id"])
        )
        
        return {"message_id": message_id, "read_at": now_iso()}


async def tool_summarize_thread(args: dict[str, Any]) -> dict:
    """Summarize a message thread."""
    project_key = args.get("project_key")
    thread_id = args.get("thread_id")
    include_examples = args.get("include_examples", False)
    
    if not project_key:
        raise ValueError("project_key is required")
    if not thread_id:
        raise ValueError("thread_id is required")
    
    with get_db() as conn:
        # Get project
        project = conn.execute(
            "SELECT * FROM projects WHERE human_key = ?",
            (project_key,)
        ).fetchone()
        if not project:
            raise ValueError(f"Project not found: {project_key}")
        
        # Get messages in thread
        rows = conn.execute(
            """SELECT m.*, a.name as from_name
               FROM messages m
               JOIN agents a ON m.sender_id = a.id
               WHERE m.thread_id = ? AND m.project_id = ?
               ORDER BY m.created_ts ASC""",
            (thread_id, project["id"])
        ).fetchall()
        
        # Build summary
        participants = list(set(row["from_name"] for row in rows))
        
        # Simple key points extraction (just use subjects for now)
        key_points = [row["subject"] for row in rows[:5]]
        
        # Action items (messages with "urgent" importance)
        action_items = [
            row["subject"] for row in rows 
            if row["importance"] == "urgent"
        ]
        
        result = {
            "thread_id": thread_id,
            "summary": {
                "participants": participants,
                "key_points": key_points,
                "action_items": action_items,
                "total_messages": len(rows),
            }
        }
        
        if include_examples and rows:
            examples = []
            for row in rows[:3]:
                examples.append({
                    "id": row["id"],
                    "subject": row["subject"],
                    "from": row["from_name"],
                    "body_md": row["body_md"],
                })
            result["examples"] = examples
        
        return result


async def tool_file_reservation_paths(args: dict[str, Any]) -> dict:
    """Reserve file paths for exclusive editing."""
    project_key = args.get("project_key")
    agent_name = args.get("agent_name")
    paths = args.get("paths", [])
    ttl_seconds = args.get("ttl_seconds", 3600)
    exclusive = args.get("exclusive", True)
    reason = args.get("reason", "")
    
    if not project_key:
        raise ValueError("project_key is required")
    if not agent_name:
        raise ValueError("agent_name is required")
    if not paths:
        raise ValueError("paths is required (list of path patterns)")
    
    with get_db() as conn:
        # Get project and agent
        project = conn.execute(
            "SELECT * FROM projects WHERE human_key = ?",
            (project_key,)
        ).fetchone()
        if not project:
            raise ValueError(f"Project not found: {project_key}")
        
        agent = conn.execute(
            "SELECT * FROM agents WHERE name = ? AND project_id = ?",
            (agent_name, project["id"])
        ).fetchone()
        if not agent:
            raise ValueError(f"Agent not found: {agent_name}")
        
        project_id = project["id"]
        agent_id = agent["id"]
        
        # Check for conflicts with existing reservations
        conflicts = []
        granted = []
        now = now_iso()
        expires = (datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)).isoformat()
        
        # Clean up expired reservations first
        conn.execute(
            "DELETE FROM file_reservations WHERE expires_ts < ?",
            (now,)
        )
        
        for path in paths:
            # Check for conflicting exclusive reservations
            # Simple matching: exact match or glob patterns
            conflicting = conn.execute(
                """SELECT fr.*, a.name as holder_name
                   FROM file_reservations fr
                   JOIN agents a ON fr.agent_id = a.id
                   WHERE fr.project_id = ? 
                   AND fr.agent_id != ?
                   AND fr.exclusive = 1
                   AND (fr.path_pattern = ? OR fr.path_pattern LIKE ? OR ? LIKE fr.path_pattern)""",
                (project_id, agent_id, path, path.replace("*", "%"), path.replace("*", "%"))
            ).fetchall()
            
            if conflicting:
                conflicts.append({
                    "path": path,
                    "holders": [r["holder_name"] for r in conflicting],
                })
            else:
                # Grant the reservation
                cursor = conn.execute(
                    """INSERT INTO file_reservations 
                       (project_id, agent_id, path_pattern, exclusive, reason, created_ts, expires_ts)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (project_id, agent_id, path, 1 if exclusive else 0, reason, now, expires)
                )
                granted.append({
                    "id": cursor.lastrowid,
                    "path_pattern": path,
                    "exclusive": exclusive,
                    "reason": reason,
                    "expires_ts": expires,
                })
        
        return {
            "granted": granted,
            "conflicts": conflicts,
        }


async def tool_release_file_reservations(args: dict[str, Any]) -> dict:
    """Release file reservations."""
    project_key = args.get("project_key")
    agent_name = args.get("agent_name")
    paths = args.get("paths")
    file_reservation_ids = args.get("file_reservation_ids")
    
    if not project_key:
        raise ValueError("project_key is required")
    if not agent_name:
        raise ValueError("agent_name is required")
    
    with get_db() as conn:
        # Get project and agent
        project = conn.execute(
            "SELECT * FROM projects WHERE human_key = ?",
            (project_key,)
        ).fetchone()
        if not project:
            raise ValueError(f"Project not found: {project_key}")
        
        agent = conn.execute(
            "SELECT * FROM agents WHERE name = ? AND project_id = ?",
            (agent_name, project["id"])
        ).fetchone()
        if not agent:
            raise ValueError(f"Agent not found: {agent_name}")
        
        # Build delete query
        if file_reservation_ids:
            # Delete by IDs
            placeholders = ",".join("?" * len(file_reservation_ids))
            cursor = conn.execute(
                f"""DELETE FROM file_reservations 
                    WHERE id IN ({placeholders}) AND agent_id = ?""",
                (*file_reservation_ids, agent["id"])
            )
        elif paths:
            # Delete by paths
            placeholders = ",".join("?" * len(paths))
            cursor = conn.execute(
                f"""DELETE FROM file_reservations 
                    WHERE path_pattern IN ({placeholders}) AND agent_id = ?""",
                (*paths, agent["id"])
            )
        else:
            # Delete all for this agent
            cursor = conn.execute(
                "DELETE FROM file_reservations WHERE agent_id = ?",
                (agent["id"],)
            )
        
        return {
            "released": cursor.rowcount,
            "released_at": now_iso(),
        }


async def tool_acknowledge_message(args: dict[str, Any]) -> dict:
    """Acknowledge a message."""
    project_key = args.get("project_key")
    agent_name = args.get("agent_name")
    message_id = args.get("message_id")
    
    if not all([project_key, agent_name, message_id]):
        raise ValueError("project_key, agent_name, and message_id are required")
    
    with get_db() as conn:
        # Get agent
        project = conn.execute(
            "SELECT * FROM projects WHERE human_key = ?",
            (project_key,)
        ).fetchone()
        if not project:
            raise ValueError(f"Project not found: {project_key}")
        
        agent = conn.execute(
            "SELECT * FROM agents WHERE name = ? AND project_id = ?",
            (agent_name, project["id"])
        ).fetchone()
        if not agent:
            raise ValueError(f"Agent not found: {agent_name}")
        
        # Update ack timestamp
        now = now_iso()
        conn.execute(
            """UPDATE message_recipients 
               SET acked_at = ? 
               WHERE message_id = ? AND agent_id = ?""",
            (now, message_id, agent["id"])
        )
        
        return {"message_id": message_id, "acked_at": now}


async def tool_search_messages(args: dict[str, Any]) -> list[dict]:
    """Search messages using FTS5."""
    project_key = args.get("project_key")
    query = args.get("query", "")
    limit = args.get("limit", 20)
    
    if not project_key:
        raise ValueError("project_key is required")
    if not query:
        raise ValueError("query is required")
    
    with get_db() as conn:
        # Get project
        project = conn.execute(
            "SELECT * FROM projects WHERE human_key = ?",
            (project_key,)
        ).fetchone()
        if not project:
            raise ValueError(f"Project not found: {project_key}")
        
        # Search using FTS5
        rows = conn.execute(
            """SELECT m.*, a.name as from_name
               FROM messages m
               JOIN messages_fts fts ON m.id = fts.rowid
               JOIN agents a ON m.sender_id = a.id
               WHERE m.project_id = ? AND messages_fts MATCH ?
               ORDER BY rank
               LIMIT ?""",
            (project["id"], query, limit)
        ).fetchall()
        
        return [
            {
                "id": row["id"],
                "subject": row["subject"],
                "from": row["from_name"],
                "created_ts": row["created_ts"],
                "importance": row["importance"],
                "thread_id": row["thread_id"],
            }
            for row in rows
        ]


# =============================================================================
# Main
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
