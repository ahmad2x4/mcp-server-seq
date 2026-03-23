#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import 'dotenv/config';

// Configuration and constants
const SEQ_BASE_URL = process.env.SEQ_BASE_URL || 'http://localhost:8080';
const SEQ_API_KEY = process.env.SEQ_API_KEY || '';
const MAX_EVENTS = 50;

if (!SEQ_API_KEY) {
  console.error('Warning: SEQ_API_KEY is not set. Some Seq instances require authentication.');
}

// Types for Seq API responses
interface Signal {
  Id: string;
  Title: string;
  Description?: string;
  Filters: unknown[];
  OwnerId?: string;
  IsShared: boolean;
}

interface SeqEvent {
  Id: string;
  Timestamp: string;
  Level: string;
  MessageTemplateTokens?: unknown[];
  RenderedMessage?: string;
  Properties?: Record<string, unknown>;
  Exception?: string;
  [key: string]: unknown;
}

// Create the MCP server
const server = new McpServer({
  name: "seq-mcp-server",
  version: "1.0.0"
});

// Helper function for Seq API requests
async function makeSeqRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${SEQ_BASE_URL}${endpoint}`);

  if (SEQ_API_KEY) {
    url.searchParams.append('apiKey', SEQ_API_KEY);
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (SEQ_API_KEY) {
    headers['X-Seq-ApiKey'] = SEQ_API_KEY;
  }

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch { /* ignore */ }
    throw new Error(`Seq API error ${response.status} (${response.statusText})${body ? `: ${body}` : ''}`);
  }

  return response.json();
}

// Resource for listing signals
server.resource(
  "signals",
  "seq://signals",
  {
    description: "List of saved Seq signals that can be used with seq_get_events to filter log events by category or service"
  },
  async () => {
    try {
      const signals = await makeSeqRequest<Signal[]>('/api/signals', { shared: 'true' });
      const formattedSignals = signals.map(signal => ({
        id: signal.Id,
        title: signal.Title,
        description: signal.Description || 'No description provided',
        shared: signal.IsShared,
        ownerId: signal.OwnerId
      }));

      return {
        contents: [{
          uri: 'seq://signals',
          text: JSON.stringify(formattedSignals, null, 2)
        }]
      };
    } catch (error) {
      console.error('Error fetching signals:', error);
      throw error;
    }
  }
);

// Schema for time range validation
const timeRangeSchema = z.enum(['1m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '7d', '14d', '30d']);

// Tool: List signals
server.tool(
  "seq_get_signals",
  "List saved Seq signals (named filters). Use signal IDs with seq_get_events to narrow results to a specific service or category.",
  {
    ownerId: z.string().optional()
      .describe('Filter signals by owner ID'),
    shared: z.boolean().optional()
      .describe('Filter by shared status. Defaults to true (shared signals only)'),
    partial: z.boolean().optional()
      .describe('Include partial signal matches')
  },
  async ({ ownerId, shared, partial }) => {
    try {
      const params: Record<string, string> = {
        shared: shared?.toString() ?? "true"
      };
      if (ownerId) params.ownerId = ownerId;
      if (partial !== undefined) params.partial = partial.toString();

      const signals = await makeSeqRequest<Signal[]>('/api/signals', params);

      return {
        content: [{
          type: "text",
          text: JSON.stringify(signals, null, 2)
        }]
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: [{
          type: "text",
          text: `Error fetching signals: ${err.message}. Verify SEQ_BASE_URL (${SEQ_BASE_URL}) is correct and the server is reachable.`
        }],
        isError: true
      };
    }
  }
);

// Tool: Get events
server.tool(
  "seq_get_events",
  `Retrieve structured log events from Seq. Use to investigate errors, analyze patterns, or monitor application health.

Tips:
- Call seq_get_signals first to find signal IDs for targeted filtering
- Start with a broad time range, then narrow using filter expressions
- Filter expressions use Seq query syntax, e.g.: @Level = 'Error', StatusCode >= 500, RequestPath like '/api/%'
- Combine signal + filter for precise results
- Use render=true to get human-readable rendered messages instead of raw message templates
- Use the 'after' parameter with the last event ID to page through large result sets`,
  {
    signal: z.string().optional()
      .describe('Comma-separated signal IDs to scope results (get IDs from seq_get_signals)'),
    filter: z.string().optional()
      .describe("Seq filter expression, e.g. \"@Level = 'Error'\" or \"StatusCode >= 500\""),
    count: z.number().min(1).max(MAX_EVENTS).optional()
      .default(20)
      .describe(`Number of events to return (1–${MAX_EVENTS}, default 20)`),
    fromDateUtc: z.string().optional()
      .describe('Start of time range in UTC ISO 8601, e.g. "2024-01-15T10:00:00Z"'),
    toDateUtc: z.string().optional()
      .describe('End of time range in UTC ISO 8601, e.g. "2024-01-15T11:00:00Z"'),
    range: timeRangeSchema.optional()
      .describe('Relative time range; takes precedence over fromDateUtc/toDateUtc. Options: 1m, 15m, 30m, 1h, 2h, 6h, 12h, 1d, 7d, 14d, 30d'),
    after: z.string().optional()
      .describe('Pagination cursor: pass the last event ID from a previous response to fetch the next page'),
    render: z.boolean().optional()
      .default(false)
      .describe('Render message templates into human-readable strings (adds RenderedMessage to each event)')
  },
  async ({ signal, filter, count, fromDateUtc, toDateUtc, range, after, render }) => {
    try {
      const params: Record<string, string> = {};

      if (range) {
        params.range = range;
      } else if (fromDateUtc || toDateUtc) {
        if (fromDateUtc) params.fromDateUtc = fromDateUtc;
        if (toDateUtc) params.toDateUtc = toDateUtc;
      } else {
        params.range = '1h';
      }

      if (signal) params.signal = signal;
      if (filter) params.filter = filter;
      if (count) params.count = count.toString();
      if (after) params.after = after;
      if (render) params.render = 'true';

      const events = await makeSeqRequest<SeqEvent[]>('/api/events', params);

      return {
        content: [{
          type: "text",
          text: JSON.stringify(events, null, 2)
        }]
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: [{
          type: "text",
          text: `Error fetching events: ${err.message}. Check that filter syntax is valid Seq query syntax and that any signal IDs exist (use seq_get_signals to list them).`
        }],
        isError: true
      };
    }
  }
);

// Tool: Get alert state
server.tool(
  "seq_get_alert_state",
  "Get the current state of all Seq alerts. Returns firing, ok, or suppressed status for each configured alert.",
  {},
  async () => {
    try {
      const alertState = await makeSeqRequest<Record<string, unknown>>('/api/alertstate');

      return {
        content: [{
          type: "text",
          text: JSON.stringify(alertState, null, 2)
        }]
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: [{
          type: "text",
          text: `Error fetching alert state: ${err.message}. Verify the Seq server is reachable at ${SEQ_BASE_URL}.`
        }],
        isError: true
      };
    }
  }
);

// Start the server with stdio transport
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

process.stdin.on("close", () => {
  console.error("Seq MCP Server closed");
  server.close();
});

export default server;
