// stdio entry for Claude Code on the VPS. Source tag from MOSAIC_SOURCE (default vps-claude).
// stdout is the MCP channel: all logging goes to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './tools.ts';
import { loadPlugins } from './plugins/index.ts';

console.log = (...a: unknown[]) => console.error(...a);
await loadPlugins();

const source = (process.env.MOSAIC_SOURCE || 'vps-claude').replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'vps-claude';
const server = buildMcpServer(source);
await server.connect(new StdioServerTransport());
