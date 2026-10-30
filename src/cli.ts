#!/usr/bin/env node
/**
 * vectorsearch CLI.
 *
 *   vectorsearch store <information> [--collection name]
 *   vectorsearch find <query> [--collection name]
 *   vectorsearch mcp
 *   vectorsearch --version
 *
 * Exit codes: 0 success, 1 service error, 2 usage error.
 * Service URL: QDRANT_URL (default http://localhost:6333).
 * Default collection: COLLECTION_NAME (default "documents").
 */
import { createVectorSearch, VERSION } from "./vector.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  vectorsearch store <information> [--collection name]
  vectorsearch find <query> [--collection name]
  vectorsearch mcp
  vectorsearch --version`);
  process.exit(2);
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function withoutFlags(args: string[], valueFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.includes(args[i])) i++;
    else out.push(args[i]);
  }
  return out;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const search = createVectorSearch(fetchFn);
  try {
    if (cmd === "store") {
      const positional = withoutFlags(rest, ["--collection"]);
      const information = positional.join(" ").trim();
      if (!information) usage();
      const out = await search.store({
        information,
        collection_name: flagValue(rest, "--collection"),
      });
      console.log(JSON.stringify(out, null, 2));
    } else if (cmd === "find") {
      const positional = withoutFlags(rest, ["--collection"]);
      const query = positional.join(" ").trim();
      if (!query) usage();
      const out = await search.find({
        query,
        collection_name: flagValue(rest, "--collection"),
      });
      console.log(JSON.stringify(out, null, 2));
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
