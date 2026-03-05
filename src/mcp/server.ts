/**
 * MCP Server.
 * 
 * Exposes TierZero's workflow capabilities as MCP tools,
 * allowing other agents to use TierZero as a tool provider.
 * 
 * TODO: Implement MCP server protocol
 * - Expose loaded skill capabilities as MCP tools
 * - Handle incoming tool calls
 * - Stream results back to clients
 */

import type { SkillLoader } from "../skills/loader";

export interface McpServerOptions {
  port?: number;
  transport: "stdio" | "sse" | "streamable-http";
  skills: SkillLoader;
}

export class McpServer {
  private opts: McpServerOptions;

  constructor(opts: McpServerOptions) {
    this.opts = opts;
  }

  /**
   * Start the MCP server.
   * Exposes all loaded skill capabilities as MCP tools.
   */
  async start(): Promise<void> {
    const skills = this.opts.skills.getAll();
    const totalTools = skills.reduce(
      (sum, s) => sum + s.provider.listCapabilities().length, 0
    );

    console.log(
      `[MCP Server] Would expose ${totalTools} tools from ${skills.length} skills ` +
      `(${this.opts.transport} transport, not yet implemented)`
    );

    // TODO: Implement MCP server protocol
    // - Build tool schemas from skill manifests
    // - Listen for connections
    // - Route tool calls to skill capabilities
  }

  async stop(): Promise<void> {
    // TODO: Cleanup
  }
}
