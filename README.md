# vectorsearch

vectorsearch is a small memory for agents: store a piece of
information now, then ask for it back later with a plain-language
query. It keeps exactly two operations — store and find — and backs
them with a Qdrant vector database over its REST API.

Set `QDRANT_URL` to reach a non-default service (it assumes
`http://localhost:6333`). The collection used when a call does not
name one comes from `COLLECTION_NAME` and defaults to `documents`.
Storing into a collection that does not exist yet creates it first,
sized to this tool's embedding dimension with cosine distance.

## Install

```bash
npx @reneturcios/vectorsearch find "how do we deploy the staging app"
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/vectorsearch
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
# Store something (optionally into a named collection)
vectorsearch store "the staging deploy runs from the release branch" --collection notes

# Ask for it back
vectorsearch find "staging deploy" --collection notes

# Start the MCP server
vectorsearch mcp

vectorsearch --version
```

Exit codes: `0` on success, `1` when the service call fails (the error
includes the HTTP status), `2` for usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/vectorsearch mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "vectorsearch": {
      "command": "npx",
      "args": ["-y", "@reneturcios/vectorsearch", "mcp"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "COLLECTION_NAME": "documents"
      }
    }
  }
}
```

### Tools

| Tool | Required | Optional | Purpose |
| --- | --- | --- | --- |
| `qdrant-store` | `information` (string) | `metadata` (object), `collection_name` (string) | Store some information in the Qdrant database. The text and any metadata become the point payload. |
| `qdrant-find` | `query` (string) | `collection_name` (string) | Retrieve relevant information from the Qdrant database. Returns the closest stored entries with their payloads and scores. |

## About the embeddings

The reference design pairs Qdrant with an external embedding model.
This rebuild deliberately calls no external embedding service.
Instead it embeds text locally with a deterministic hash-based
function: the same text always produces the same unit vector, and
texts that share tokens land near each other, which keeps store and
find self-consistent and fully offline. Be clear-eyed about the
trade-off: this is a local fallback with token-overlap similarity,
not model-grade semantic embeddings. Swapping in a real embedding
provider later only changes the executor's vector function — the
tools, schemas, and storage shape stay the same.

Point ids are likewise deterministic, derived from a hash of the
text (and metadata when present), so re-storing the same information
updates the same point instead of piling up duplicates.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, fakes only, no live service
npm run dev     # run the CLI from source via tsx
```

Dispatch, default-collection resolution, and error propagation are
tested against a fake executor; the Qdrant REST executor is tested
against a fake fetch that records its requests (collection ensure /
create-on-missing, point upsert shape, search mapping).

## License

MIT — see `LICENSE`.
