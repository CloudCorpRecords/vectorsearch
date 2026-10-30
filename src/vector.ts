/**
 * vectorsearch core: store and retrieve text in a Qdrant database.
 *
 * Two layers:
 *  - `VectorSearch` is the dispatch layer the MCP server and CLI use.
 *    It resolves the effective collection (explicit argument wins,
 *    otherwise the configured default, which comes from the
 *    COLLECTION_NAME environment variable) and delegates to an
 *    injected `VectorExecutor`.
 *  - `QdrantExecutor` is the default executor. It speaks the Qdrant
 *    REST API: ensure the collection exists, upsert one point per
 *    stored text, and search points for a query. `QDRANT_URL` sets
 *    the service base (default http://localhost:6333).
 *
 * Embeddings: the reference server pairs Qdrant with an external
 * embedding model. This rebuild has no external embedding service
 * available, so it uses a deterministic local hash-based embedding
 * (see `hashEmbedding`): the same text always maps to the same
 * unit vector, and texts sharing tokens land near each other. That
 * keeps store/find self-consistent and fully offline, at the cost of
 * real semantic quality — it is a fallback, documented as such in
 * the README, not a claim of model-grade embeddings.
 */
import type { FetchFn, FindOptions, StoreOptions, VectorExecutor } from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_QDRANT_URL = "http://localhost:6333";

export const DEFAULT_COLLECTION = "documents";

export const EMBEDDING_DIM = 64;

export const SEARCH_LIMIT = 5;

export function resolveQdrantUrl(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = explicit?.trim() || env.QDRANT_URL?.trim() || DEFAULT_QDRANT_URL;
  return raw.replace(/\/+$/, "");
}

export function resolveDefaultCollection(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = explicit?.trim() || env.COLLECTION_NAME?.trim() || DEFAULT_COLLECTION;
  return raw;
}

// ---------------------------------------------------------------------------
// Deterministic local hash embedding (fallback — no external service)
// ---------------------------------------------------------------------------

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Map text to a deterministic unit vector of EMBEDDING_DIM dimensions.
 * Each token contributes pseudo-random components seeded by its hash,
 * so identical texts embed identically and token overlap pulls
 * vectors together. Purely local and synchronous by design.
 */
export function hashEmbedding(text: string, dim: number = EMBEDDING_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const grams = tokens.length > 0 ? tokens : [text.toLowerCase()];
  for (const gram of grams) {
    let seed = fnv1a(gram);
    for (let i = 0; i < dim; i++) {
      // xorshift32 step per component for a stable spread.
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      vec[i] += seed / 0xffffffff - 0.5;
    }
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Deterministic positive integer point id derived from the text. */
export function pointIdFor(text: string, metadata?: Record<string, unknown>): number {
  const seed = metadata ? `${text}\n${JSON.stringify(metadata)}` : text;
  return fnv1a(seed) % 2_000_000_000;
}

// ---------------------------------------------------------------------------
// Qdrant REST executor
// ---------------------------------------------------------------------------

async function parseBody(text: string): Promise<unknown> {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class QdrantExecutor implements VectorExecutor {
  readonly baseUrl: string;

  constructor(
    private readonly fetchFn: FetchFn,
    baseUrl?: string,
  ) {
    this.baseUrl = resolveQdrantUrl(baseUrl);
  }

  private async request(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    let response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new Error(
        `Request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const text = await response.text();
    const data = await parseBody(text);
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Qdrant request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${text ? `: ${text.slice(0, 500)}` : ""}`,
      );
    }
    return { status: response.status, data };
  }

  /** Create the collection when it does not exist yet. */
  async ensureCollection(collection: string): Promise<void> {
    const url = `${this.baseUrl}/collections/${encodeURIComponent(collection)}`;
    const { status } = await this.request("GET", url);
    if (status === 404) {
      await this.request("PUT", url, {
        vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
      });
    }
  }

  async store(
    collection: string,
    information: string,
    metadata?: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ensureCollection(collection);
    const payload: Record<string, unknown> = {
      ...(metadata ?? {}),
      information,
    };
    const point = {
      id: pointIdFor(information, metadata),
      vector: hashEmbedding(information),
      payload,
    };
    const { data } = await this.request(
      "PUT",
      `${this.baseUrl}/collections/${encodeURIComponent(collection)}/points`,
      { points: [point] },
    );
    return data ?? { status: "ok", collection, id: point.id };
  }

  async find(collection: string, query: string): Promise<unknown> {
    const { data } = await this.request(
      "POST",
      `${this.baseUrl}/collections/${encodeURIComponent(collection)}/points/search`,
      {
        vector: hashEmbedding(query),
        limit: SEARCH_LIMIT,
        with_payload: true,
      },
    );
    const result =
      data && typeof data === "object" && "result" in data
        ? (data as { result: unknown }).result
        : data;
    if (Array.isArray(result)) {
      return result.map((hit) => {
        const h = (hit ?? {}) as {
          payload?: Record<string, unknown>;
          score?: unknown;
          id?: unknown;
        };
        const payload = h.payload ?? {};
        return {
          information:
            typeof payload.information === "string" ? payload.information : "",
          metadata: payload,
          ...(h.score !== undefined ? { score: h.score } : {}),
          ...(h.id !== undefined ? { id: h.id } : {}),
        };
      });
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Dispatch layer
// ---------------------------------------------------------------------------

export class VectorSearch {
  readonly defaultCollection: string;

  constructor(
    private readonly executor: VectorExecutor,
    defaultCollection?: string,
  ) {
    this.defaultCollection = resolveDefaultCollection(defaultCollection);
  }

  private collection(explicit?: string): string {
    const name = explicit?.trim();
    return name ? name : this.defaultCollection;
  }

  async store(options: StoreOptions): Promise<unknown> {
    const information =
      typeof options.information === "string" ? options.information : "";
    if (!information.trim()) {
      throw new Error("information must be a non-empty string");
    }
    return this.executor.store(
      this.collection(options.collection_name),
      information,
      options.metadata,
    );
  }

  async find(options: FindOptions): Promise<unknown> {
    const query = typeof options.query === "string" ? options.query : "";
    if (!query.trim()) {
      throw new Error("query must be a non-empty string");
    }
    return this.executor.find(this.collection(options.collection_name), query);
  }
}

export function createVectorSearch(
  fetchFn: FetchFn,
  options: { baseUrl?: string; defaultCollection?: string } = {},
): VectorSearch {
  return new VectorSearch(
    new QdrantExecutor(fetchFn, options.baseUrl),
    options.defaultCollection,
  );
}
