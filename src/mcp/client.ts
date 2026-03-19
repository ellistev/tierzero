/**
 * MCP Client.
 * 
 * Connects to MCP (Model Context Protocol) servers to discover and use
 * external tools. When a needed capability isn't available in local skills,
 * TierZero checks connected MCP servers.
 * 
 * TODO: Implement MCP client protocol
 * - Connect to MCP server endpoints
 * - Discover available tools
 * - Execute tool calls
 * - Handle streaming responses
 */

import { createLogger } from "../infra/logger";
const log = createLogger("mcp-client");

export interface McpServerConfig {
  name: string;
  url: string;
  transport: "stdio" | "sse" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  server: string;
}

export class McpClient {
  private servers: Map<string, McpServerConfig> = new Map();
  private tools: Map<string, McpTool> = new Map();

  /**
   * Register an MCP server connection.
   */
  addServer(config: McpServerConfig): void {
    this.servers.set(config.name, config);
  }

  /**
   * Connect to all registered servers and discover tools.
   */
  async connect(): Promise<void> {
    // TODO: Implement MCP protocol connection
    // For each server: handshake, list tools, cache schemas
    log.info(`${this.servers.size} server(s) configured (connection not yet implemented)`);
  }

  /**
   * Find a tool by capability name across all connected servers.
   */
  findTool(capability: string): McpTool | null {
    return this.tools.get(capability) ?? null;
  }

  /**
   * Execute a tool on a connected MCP server.
   */
  async executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) throw new Error(`MCP tool not found: ${toolName}`);

    // TODO: Send tool call to MCP server, return result
    throw new Error("MCP tool execution not yet implemented");
  }

  /**
   * List all available tools across all connected servers.
   */
  listTools(): McpTool[] {
    return [...this.tools.values()];
  }
}
