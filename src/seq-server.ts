#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import 'dotenv/config';

// Configuration and constants
const SEQ_BASE_URL = process.env.SEQ_BASE_URL || 'http://localhost:8080';
const SEQ_API_KEY = process.env.SEQ_API_KEY || '';
const MAX_EVENTS = 20;

// Types for SEQ API responses
interface Signal {
  id: string;
  title: string;
  description?: string;
  filters: unknown;
  ownerId?: string;
  shared: boolean;
}

type Event = any;

// Create the MCP server
const server = new McpServer({
  name: "seq-server",
  version: "1.0.0"
});

// Helper function for SEQ API requests
async function makeSeqRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${SEQ_BASE_URL}${endpoint}`);
  
  // Add API key as query parameter
  url.searchParams.append('apiKey', SEQ_API_KEY);
  
  // Add additional query parameters
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'X-Seq-ApiKey': SEQ_API_KEY
  };

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    throw new Error(`SEQ API error: ${response.statusText} (${response.status})`);
  }

  return response.json();
}

// Resource for listing signals
server.resource(
  "signals",
  "seq://signals",
  {
    description: "List of saved Seq signals that can be used with the get-events tool to filter log events"
  },
  async () => {
    try {
      const signals = await makeSeqRequest<Signal[]>('/api/signals', { shared: 'true' });
      const formattedSignals = signals.map(signal => ({
        id: signal.id,
        title: signal.title,
        description: signal.description || 'No description provided',
        shared: signal.shared,
        ownerId: signal.ownerId
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

// Tool for fetching signals with filters
server.tool(
  "get-signals",
  {
    ownerId: z.string().optional()
      .describe('Owner ID to filter signals by'),
    shared: z.boolean().optional()
      .describe('Whether to include only shared signals (true) or private signals (false)'),
    partial: z.boolean().optional()
      .describe('Whether to include partial signal matches')
  },
  async ({ ownerId, shared, partial }) => {
    try {
      const params: Record<string, string> = {
        // Default to shared=true if no other params provided
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
          text: `Error fetching signals: ${err.message}`
        }],
        isError: true
      };
    }
  }
);

// Schema for time range validation
const timeRangeSchema = z.enum(['1m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '7d', '14d', '30d']);

// Tool for fetching events with enhanced parameters
server.tool(
  "get-events",
  `Retrieve and analyze a list of event filtered by parameters. Use this tool when you need to:
  - Investigate events that are being logged in the SEQ server
  - Details of each event is a structured log and can provide usefull information
  - Events could be information, error, debug, or critical
  - Analyze error patterns and frequencies  
  `,
  {
    signal: z.string().optional()
      .describe('Comma-separated list of signal IDs'),
    filter: z.string().optional()
      .describe('Filter expression for events'),
    count: z.number().min(1).max(MAX_EVENTS).optional()
      .default(MAX_EVENTS)
      .describe(`Number of events to return (max ${MAX_EVENTS})`),
    fromDateUtc: z.string().optional()
      .describe('Start date/time in UTC'),
    toDateUtc: z.string().optional()
      .describe('End date/time in UTC'),
    range: timeRangeSchema.optional()
      .describe('Time range (e.g., 1m, 15m, 1h, 1d, 7d)')
  },
  async ({ signal, filter, count, fromDateUtc, toDateUtc, range }) => {
    try {
      const params: Record<string, string> = {};
      
      // Handle date range parameters
      if (range) {
        // If range is provided, it takes precedence over fromDateUtc/toDateUtc
        params.range = range;
      } else if (fromDateUtc || toDateUtc) {
        // Only add date parameters if they're provided
        if (fromDateUtc) params.fromDateUtc = fromDateUtc;
        if (toDateUtc) params.toDateUtc = toDateUtc;
      } else {
        // Default to last hour if no time parameters provided
        params.range = '1h';
      }

      // Add other optional parameters
      if (signal) params.signal = signal;
      if (filter) params.filter = filter;
      if (count) params.count = count.toString();

      const events = await makeSeqRequest<Event[]>('/api/events', params);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(events)
        }]
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: [{
          type: "text",
          text: `Error fetching events: ${err.message}`
        }],
        isError: true
      };
    }
  }
);


// Tool for fetching alert state
server.tool(
  "get-alertstate",
  {},
  async () => {
    try {
      const alertState = await makeSeqRequest<any>('/api/alertstate');
      
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
          text: `Error fetching alert state: ${err.message}`
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

// Always run the server when this file is executed directly
runServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Handle stdin close gracefully
process.stdin.on("close", () => {
  console.error("Seq MCP Server closed");
  server.close();
});

export default server;