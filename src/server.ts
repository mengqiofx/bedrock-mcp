import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// toolsets
export function getWeekOffset(pastDate: string): number {
  if (!pastDate || typeof pastDate !== 'string') {
    return 0;
  }
  // Normalize expected ISO (YYYY-MM-DD)
  const trimmed = pastDate.trim();
  // Basic format guard
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return 0;
  }
  const past = new Date(trimmed + 'T00:00:00Z');
  if (isNaN(past.getTime())) {
    return 0;
  }
  const today = new Date();
  const future = past.getTime() > today.getTime();
  const diffTime = Math.abs(today.getTime() - past.getTime());
  let diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));
  // +1 baseline, clamp to at least 1
  let result = diffWeeks + 1;
  if (result < 1) result = 1;
  if (future) {
    // For future dates we still return a positive offset (treat as 1) but log
    if (result !== 1) result = 1;
  } else {
  }
  return result;
}

// Helper: normalize a wide variety of user date expressions to YYYY-MM-DD
// Accepted examples:
//  2025.06.01  2025/6/1  2025-6-1  2025_06_01
//  June 1 2025 / 1 June 2025 / June 1st, 2025
// Returns '' if cannot confidently parse.
export function normaliseDate(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  // Quick direct numeric patterns: YYYY[-./_]M[M]?[-./_]D[D]?
  const direct = s.match(/^(\d{4})[-./_](\d{1,2})[-./_](\d{1,2})$/);
  if (direct) {
    const [, y, m, d] = direct;
    const month = m.padStart(2, '0');
    const day = d.padStart(2, '0');
    if (+month >= 1 && +month <= 12 && +day >= 1 && +day <= 31) return `${y}-${month}-${day}`;
  }
  // Month name patterns
  const MONTHS: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07',
    august: '08', september: '09', october: '10', november: '11', december: '12'
  };
  const lowered = s.toLowerCase().replace(/,/g, '');
  // Pattern: Month D(st|nd|rd|th)? YYYY
  let m1 = lowered.match(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})$/);
  if (m1) {
    const [, mon, d, y] = m1;
    const day = d.padStart(2, '0');
    return `${y}-${MONTHS[mon]}-${day}`;
  }
  // Pattern: D(st)? Month YYYY
  let m2 = lowered.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})$/);
  if (m2) {
    const [, d, mon, y] = m2;
    const day = d.padStart(2, '0');
    return `${y}-${MONTHS[mon]}-${day}`;
  }
  return '';
}

const server = new McpServer({
  name: "test-video",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
    prompts: {},
  },
})

// Wrap transport for low-level logging (tap JSON-RPC frames)
class LoggingTransport extends StdioServerTransport {
  // @ts-ignore access underlying write for debug
  async send(message: any) {
    console.error('[MCP] ->', message?.method || (message?.result ? 'result' : 'message'), message?.id ?? '');
    return super.send(message);
  }
}

server.tool(
  'weekOffset',
  {
    description: 'Calculate week offset from today to a past YYYY-MM-DD date',
    inputSchema: {
      pastDate: z.string().describe('Target date in YYYY-MM-DD format')
    }
  },
  async ({ pastDate }) => {

    const weeks = getWeekOffset(pastDate);
    return { content: [{ type: 'text', text: String(weeks) }] };
  }
);

server.tool(
  'normaliseDate',
  {
    description: 'Normalise a user supplied date (e.g. 2025.06.01 / 2025/6/1 / June 1 2025) to YYYY-MM-DD; empty string if invalid',
    inputSchema: {
      rawDate: z.string().describe('User supplied date expression')
    }
  },
  async ({ rawDate }) => {
    const norm = normaliseDate(rawDate);

    return { content: [{ type: 'text', text: norm }] };
  }
);


// Static resource that lists all available festivals
server.resource(
  "calendar-list",
  "calendar://all-festivals",
  {
    description: "List all available festivals and their dates from the calendar database",
    title: "All Festivals Calendar",
    mimeType: "application/json",
  },
  async (uri) => {
    const calendar = await import("./data/calendar.json", {
      with: { type: "json" },
    }).then(m => m.default as Array<{ name: string; date: string }>)

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(calendar, null, 2),
          mimeType: "application/json",
        },
      ],
    }
  }
);

server.resource(
  "festival-date",
  new ResourceTemplate("calendar://festival/{festival}/date", { list: undefined }),
  {
    description: "Get the date for a named festival from the calendar database",
    title: "Festival Date",
    mimeType: "application/json",
  },
  async (uri, { festival }) => {
    const calendar = await import("./data/calendar.json", {
      with: { type: "json" },
    }).then(m => m.default as Array<{ name: string; date: string }>)

    // Decode in case the client encoded spaces / punctuation
    const raw = festival ? decodeURIComponent(String(festival)) : "";
    const key = raw.trim().toLowerCase();
    const entry = calendar.find(
      f => f.name?.trim().toLowerCase() === key
    )

    if (!entry) {
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({ error: `Festival not found: ${raw}` }),
            mimeType: "application/json",
          },
        ],
      }
    }

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({ name: entry.name, date: entry.date }),
          mimeType: "application/json",
        },
      ],
    }
  }
)

server.prompt(
  'get-duration',
  'Extract duration (number of weeks) from user query',
  {
    query: z.string().describe('User query'),
    knownDuration: z.string().optional().describe('Previously extracted duration as string if any')
  },
  ({ query, knownDuration }) => {
    const system = `Extract duration in weeks from the user's query.
    
Convert time phrases to weeks:
- "2 weeks" → 2
- "1 month" → 4  
- "3 months" → 12
- "6 months" → 24
- "1 year" → 52
- "ytd" → weeks since Jan 1

Rules:
- Return integer ≥1
- If already have duration from previous context, return it unless user mentions different timeframe
- If no clear duration found, return null

Return ONLY JSON: {"duration":12|null,"confidence":0.8}`;

    const input = { query, knownDuration: knownDuration || null };
    return {
      messages: [
        { role: 'assistant', content: { type: 'text', text: system } },
        { role: 'user', content: { type: 'text', text: JSON.stringify(input) } }
      ]
    };
  }
);

server.tool(
  "add",
  "Add two numbers and return the sum",
  {
    a: z.number(),
    b: z.number(),
  },
  {
    title: "Add Numbers",
    readOnlyHint: true,
    idempotentHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  async ({ a, b }) => {
    const sum = a + b
    return {
      content: [{ type: "text", text: `${sum}` }],
    }
  }
)


async function main() {
  console.error("[MCP] Starting server...");
  const transport = new LoggingTransport()
  console.error("[MCP] Registering capabilities (tools/resources/prompts)...");
  await server.connect(transport)
  console.error("[MCP] Server connected (stdio awaiting client)");
}

process.on('exit', (code) => {
  console.error('[MCP] Server exiting with code', code);
});
process.on('SIGINT', () => {
  console.error('[MCP] SIGINT received, exiting.');
  process.exit(0);
});

main()
