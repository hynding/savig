/** Entry point for the Savig MCP server (stdio). Run with `pnpm mcp` (tsx). Register it with an
 *  MCP client (e.g. Claude Desktop / Claude Code) pointing at this command. */
import { runStdio } from './server';

runStdio().catch((e) => {
  console.error('savig-mcp failed to start:', e);
});
