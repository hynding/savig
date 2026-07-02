/** Wires the Savig tool table (./tools) to the Model Context Protocol over stdio, holding one
 *  stateful session (the in-progress Project) for the connection. Thin transport layer — all tool
 *  logic + state lives in ./tools and is unit-tested there. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createProject } from '@savig/engine';
import { tools, type Session } from './tools';

export function createSavigMcpServer(): { server: Server; session: Session } {
  const session: Session = { project: createProject() };
  const server = new Server({ name: 'savig', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    try {
      return tool.run(session, (req.params.arguments ?? {}) as Record<string, unknown>) as CallToolResult;
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  });

  return { server, session };
}

/** Start the server on stdio (the standard local-MCP transport — Claude Desktop / Claude Code). */
export async function runStdio(): Promise<void> {
  const { server } = createSavigMcpServer();
  await server.connect(new StdioServerTransport());
}
