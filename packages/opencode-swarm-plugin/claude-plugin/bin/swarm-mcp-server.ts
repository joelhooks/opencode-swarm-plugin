#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { allTools } from "../../dist/index.js";

type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
};

type ToolDefinition = {
  description?: string;
  args?: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown> | unknown;
};

/**
 * Build a tool execution context for MCP tool calls.
 */
function createToolContext(): ToolContext {
  const sessionId =
    process.env.CLAUDE_SESSION_ID ||
    process.env.OPENCODE_SESSION_ID ||
    `mcp-${Date.now()}`;
  const messageId =
    process.env.CLAUDE_MESSAGE_ID ||
    process.env.OPENCODE_MESSAGE_ID ||
    `msg-${Date.now()}`;
  const agent =
    process.env.CLAUDE_AGENT_NAME || process.env.OPENCODE_AGENT || "claude";

  return {
    sessionID: sessionId,
    messageID: messageId,
    agent,
    abort: new AbortController().signal,
  };
}

/**
 * Normalize tool execution results into text output.
 */
function formatToolOutput(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * Register all swarm tools with the MCP server.
 */
function registerTools(server: McpServer): void {
  const tools = allTools as Record<string, ToolDefinition>;

  for (const [toolName, toolDef] of Object.entries(tools)) {
    server.registerTool(
      toolName,
      {
        description: toolDef.description ?? `Swarm tool: ${toolName}`,
        inputSchema: toolDef.args ?? {},
      },
      async (args) => {
        const result = await toolDef.execute(
          (args ?? {}) as Record<string, unknown>,
          createToolContext(),
        );

        return {
          content: [{ type: "text", text: formatToolOutput(result) }],
        };
      },
    );
  }
}

/**
 * Start the MCP server over stdio for Claude Code auto-launch.
 */
async function main(): Promise<void> {
  const server = new McpServer({
    name: "swarm-tools",
    version: process.env.SWARM_VERSION || "dev",
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[swarm-mcp] Server started");
}

main().catch((error) => {
  console.error("[swarm-mcp] Server failed", error);
  process.exit(1);
});
