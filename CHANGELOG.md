# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `vectorsearch store <information> [--collection name]`,
  `vectorsearch find <query> [--collection name]`, and
  `vectorsearch mcp` for the stdio MCP server. The service URL comes
  from `QDRANT_URL` (default `http://localhost:6333`) and the default
  collection from `COLLECTION_NAME` (default `documents`).
- MCP server with 2 tools: `qdrant-store` and `qdrant-find`.
- Default executor talks to the Qdrant REST API (ensure collection,
  upsert point, search points) through an injectable fetch function.
  Embeddings use a deterministic local hash-based fallback — no
  external embedding service is called (see README).
