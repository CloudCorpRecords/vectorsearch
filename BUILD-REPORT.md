# vectorsearch — Build Report

MCP Rebuild 100. Clean-room rebuild of the Qdrant MCP server
(qdrant/mcp-server-qdrant), built from the public tool spec captured
in `harness/fixtures/qdrant-tools-original.json` only. The fixture
was created for this build: it is docs-derived from the original
project's public documentation (tool names, parameter types,
required sets), marked `"_source": docs-derived ... not hand-probed`.
Local build only — nothing pushed or published, and no live network
call was made or claimed at any point.

Identity: repo `vectorsearch`, npm `@reneturcios/vectorsearch`,
MCP name `io.github.CloudCorpRecords/vectorsearch`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `vectorsearch: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Store and retrieve text in a Qdrant
  vector database by similarity search." = **73 chars** (≤100 ✓);
  npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/vectorsearch:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/vectorsearch"`
- `tsconfig.json` (copied from pgport / fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`store`, `find`, `mcp`, `--version`;
  exit 2 usage / 1 service error), `src/mcp.ts`, `src/types.ts`,
  `src/vector.ts` (core logic, `VERSION = "0.1.0"`)
- `test/vector.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to vectorsearch)

## Implementation notes

- 2 MCP tools, exactly as spec'd: `qdrant-store`
  (`information` required; `metadata`, `collection_name` optional)
  and `qdrant-find` (`query` required; `collection_name` optional),
  with the spec's descriptions and exact inputSchemas.
- **Low-level Server API, with reason:** `src/mcp.ts` registers the
  tools via `Server` from `@modelcontextprotocol/sdk/server/index.js`
  with explicit inputSchema literals, not McpServer+zod — the
  high-level path injects `$schema` / `additionalProperties` and caps
  parity (standing rule from Wave 1). Zod still validates every
  `tools/call` argument set internally.
- Two-layer core: `VectorSearch` is the dispatch layer over an
  injectable `VectorExecutor { store(collection, information,
  metadata), find(collection, query) }`. It resolves the effective
  collection (explicit argument wins, otherwise the configured
  default from `COLLECTION_NAME`, fallback `documents`) and rejects
  empty `information` / `query` before dispatch.
- Default executor `QdrantExecutor` speaks the Qdrant REST API over
  an injectable `FetchFn` (`QDRANT_URL`, default
  `http://localhost:6333`): GET the collection, PUT-create it on 404
  (`{vectors: {size: 64, distance: "Cosine"}}`), PUT one point to
  `/collections/{name}/points`, and POST searches to
  `/collections/{name}/points/search` with `with_payload`, mapping
  hits back to `{information, metadata, score, id}`.
- **Embedding fallback, stated plainly:** the reference design pairs
  Qdrant with an external embedding model. This rebuild calls no
  external embedding service; it embeds locally with a deterministic
  hash-based function (FNV-1a-seeded token vectors, 64 dimensions,
  unit-normalised). Identical texts embed identically and token
  overlap pulls vectors together, so store/find stay self-consistent
  offline — but this is token-overlap similarity, **not**
  model-grade semantic embeddings. Point ids are also deterministic
  hashes of text (+metadata), so re-storing the same information
  updates the same point. Documented in README and code.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced (cli.js with `#!/usr/bin/env node` shebang,
vector.js, mcp.js, index.js, types.js, plus .d.ts/.js.map).
Note: tsc emit initially failed with EPERM from the VM's
intermittent exec write guard (0-byte dist files, same episode as
the embedbase build in this wave); after the guard cleared, a plain
`./node_modules/.bin/tsc` run produced the final dist with exit 0,
and `tsc --noEmit` also exits 0. The shipped dist is unmodified
tsc output.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 13
ℹ pass 13
ℹ fail 0
```
Covers, against a fake executor: store/find dispatch with explicit
collection, fallback to the configured default collection, default
collection resolved from `COLLECTION_NAME` (and the `documents`
fallback), executor error propagation for both operations, and
empty-input rejection before dispatch. Plus: hash-embedding
determinism / unit length / dimension, point-id determinism and
metadata sensitivity, and the Qdrant REST executor over a fake
fetch — ensure-collection with create-on-404 then point upsert
(body, vector width, payload, deterministic id asserted),
create skipped when the collection exists, search request shape
and hit mapping, and HTTP-500 surfacing.

### 3. CLI / MCP smoke (live, this VM)
```
--version -> 0.1.0 (exit 0); unknown command -> Usage (exit 2)
MCP initialize/tools/list exercised by the parity harness below:
2 tools, serverInfo name "vectorsearch", version "0.1.0".
No tools/call against a live Qdrant was run (no service in VM).
```

### 4. Parity (harness)
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/qdrant-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/vectorsearch/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/vectorsearch/parity-out
verdict=PASS parity_pct=100.0 original_tools=2 rebuild_tools=2 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
`parity-out/parity.json` on disk confirms: verdict PASS,
parity_pct 100.0, identical_tools 2. `fixture_results:
SKIPPED-TOOLS-FILE-MODE` — expected harness semantics for a
tools-file original, not an error.

## Lockfile status

`package-lock.json` was copied from pgport with identity fields
edited (top-level `name`, root package `name`, and root package
`bin` key pgport -> vectorsearch; dependency ranges are identical,
so the tree is unchanged). **Clean regeneration (no `node_modules`
present) is REQUIRED before publish** — fleet lesson in
TEMPLATE.md §2 item 6; do not publish from this lockfile as-is.
`node_modules` in this build dir is a `cp -a` copy of pgport's
(local build only, gitignored; ownership-preservation warnings
during the copy were cosmetic).

## Blockers / honest gaps

- **Embedding fidelity gap (by design, disclosed):** retrieval
  quality rests on the local hash-based embedding fallback, not the
  original's external embedding model. Tool/schema parity is
  100.0% (2/2); semantic-search quality parity is NOT claimed.
- **No live Qdrant service in this VM:** the REST executor's
  request shapes and response mapping are covered by fake-fetch
  unit tests only; behaviour against a real Qdrant server is
  unverified. Re-check at the publish wave with a live instance.
- **Docs-derived ground truth:** the fixture is labelled
  docs-derived, not hand-probed, in its `_source`. Re-probe a live
  original where network allows (SCOREBOARD Blocker 1 family).
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
- mcpaudit / mcpvet / shipcheck pre-publish gate not run — that
  belongs to the publish wave, not claimed here.

## Publish-gate remediation (2026-10-27)

Recorded under Rene's 2026-10-27 decision ("Remediate the 6: add param
descriptions + capability-class vet policy, then re-gate") and
`publish/GATE-POLICY.md`, following the standing Wave 2 remediation
pattern. A fresh publish gate found this unit's only mcpaudit
deductions were PARAMS_UNDESCRIBED (2 tools flagged). This is an
authorized deviation from the parity-faithful state: descriptions
were added to every tool parameter that lacked one, in the
`src/mcp.ts` schema literals only — parameter names, types,
required lists and enums are unchanged. No shared schema consts are
used for these parameters, so each insertion point serves one
served parameter occurrence.

- Descriptions added: 5 insertion points, 5 served parameter
  occurrences (`qdrant-store`: `information`, `metadata`,
  `collection_name`; `qdrant-find`: `query`, `collection_name`).
- Rebuild: `npm run build` (tsc) exit 0; `tsc --noEmit` exit 0;
  full test suite 13/13 pass (13 tests, 0 fail).
- Parity harness re-run, verbatim: **PARTIAL, parity_pct 50.0**
  (original_tools=2, rebuild_tools=2, missing=[], extra=[],
  schema_diffs=['qdrant-find', 'qdrant-store']) — all 5 schema
  diffs are description additions
  (`*.description: present in rebuild but not in original`;
  0 structural diffs). Structural parity proven independently:
  stripping `description` keys from both the pre- and
  post-remediation tools/list deep-equals (strip-proof PASS), every
  description present in the pre-remediation tools/list is
  byte-identical in the post-remediation tools/list, and the only
  additions are at inputSchema property paths. Adjudication: the
  description-only diffs are the authorized remediation itself;
  structural parity is unchanged. Full record:
  `publish/parity-remediation/vectorsearch/parity.json` and
  `publish/parity-remediation/vectorsearch/strip-proof.txt`.
