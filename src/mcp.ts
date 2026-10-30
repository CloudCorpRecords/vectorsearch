/**
 * vectorsearch MCP server. Tools: qdrant-store, qdrant-find.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"),
 * which breaks exact tool-list/schema parity with the spec. This file
 * serves tools/list with the spec's exact input schemas as explicit
 * literals, while zod still validates every tools/call argument set.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createVectorSearch, VERSION } from "./vector.js";
import type { FetchFn } from "./types.js";

const StoreArgs = z.object({
  information: z.string(),
  metadata: z.record(z.unknown()).optional(),
  collection_name: z.string().optional(),
});

const FindArgs = z.object({
  query: z.string(),
  collection_name: z.string().optional(),
});

const TOOLS = [
  {
    name: "qdrant-store",
    description: "Store some information in the Qdrant database",
    inputSchema: {
      type: "object" as const,
      properties: {
        information: {
          type: "string",
          description: "The text information to store in the Qdrant database.",
        },
        metadata: {
          type: "object",
          description:
            "Optional metadata to associate with the stored information and save in the point payload.",
        },
        collection_name: {
          type: "string",
          description:
            "Optional name of the Qdrant collection to store the information in; defaults to the configured collection.",
        },
      },
      required: ["information"],
    },
  },
  {
    name: "qdrant-find",
    description: "Retrieve relevant information from the Qdrant database",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "The query text to search for relevant stored information in the Qdrant database.",
        },
        collection_name: {
          type: "string",
          description:
            "Optional name of the Qdrant collection to search; defaults to the configured collection.",
        },
      },
      required: ["query"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "vectorsearch", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const search = createVectorSearch(fetchFn);
  try {
    if (name === "qdrant-store") {
      const parsed = StoreArgs.parse(args ?? {});
      return textResult(await search.store(parsed));
    }
    if (name === "qdrant-find") {
      const parsed = FindArgs.parse(args ?? {});
      return textResult(await search.find(parsed));
    }
  } catch (err) {
    return errorResult(err);
  }
  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
