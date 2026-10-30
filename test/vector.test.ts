import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMBEDDING_DIM,
  hashEmbedding,
  pointIdFor,
  QdrantExecutor,
  resolveDefaultCollection,
  VectorSearch,
} from "../src/vector.js";
import type { FetchFn, HttpResponse, VectorExecutor } from "../src/types.js";

function fakeExecutor(): VectorExecutor & {
  calls: Array<{ kind: string; collection: string; text: string; metadata?: Record<string, unknown> }>;
} {
  const calls: Array<{
    kind: string;
    collection: string;
    text: string;
    metadata?: Record<string, unknown>;
  }> = [];
  return {
    calls,
    async store(collection, information, metadata) {
      calls.push({ kind: "store", collection, text: information, metadata });
      return { stored: true, collection };
    },
    async find(collection, query) {
      calls.push({ kind: "find", collection, text: query });
      return [{ information: `hit for ${query}`, collection }];
    },
  };
}

describe("VectorSearch dispatch", () => {
  it("store dispatches to the executor with the explicit collection", async () => {
    const executor = fakeExecutor();
    const vs = new VectorSearch(executor, "docs-main");
    const out = await vs.store({
      information: "the sky is blue",
      metadata: { source: "test" },
      collection_name: "notes",
    });
    assert.deepEqual(out, { stored: true, collection: "notes" });
    assert.deepEqual(executor.calls, [
      { kind: "store", collection: "notes", text: "the sky is blue", metadata: { source: "test" } },
    ]);
  });

  it("find dispatches to the executor with the explicit collection", async () => {
    const executor = fakeExecutor();
    const vs = new VectorSearch(executor, "docs-main");
    const out = await vs.find({ query: "sky colour", collection_name: "notes" });
    assert.deepEqual(out, [{ information: "hit for sky colour", collection: "notes" }]);
    assert.equal(executor.calls[0].kind, "find");
    assert.equal(executor.calls[0].collection, "notes");
  });

  it("falls back to the configured default collection", async () => {
    const executor = fakeExecutor();
    const vs = new VectorSearch(executor, "docs-main");
    await vs.store({ information: "hello" });
    await vs.find({ query: "hello" });
    assert.equal(executor.calls[0].collection, "docs-main");
    assert.equal(executor.calls[1].collection, "docs-main");
  });

  it("default collection comes from COLLECTION_NAME when set", () => {
    assert.equal(resolveDefaultCollection(undefined, { COLLECTION_NAME: "team-kb" }), "team-kb");
    assert.equal(resolveDefaultCollection(undefined, {}), "documents");
    const executor = fakeExecutor();
    const vs = new VectorSearch(executor, resolveDefaultCollection(undefined, { COLLECTION_NAME: "team-kb" }));
    assert.equal(vs.defaultCollection, "team-kb");
  });

  it("propagates executor errors for store and find", async () => {
    const failing: VectorExecutor = {
      async store() {
        throw new Error("qdrant unreachable: store");
      },
      async find() {
        throw new Error("qdrant unreachable: find");
      },
    };
    const vs = new VectorSearch(failing, "docs-main");
    await assert.rejects(() => vs.store({ information: "x" }), /unreachable: store/);
    await assert.rejects(() => vs.find({ query: "x" }), /unreachable: find/);
  });

  it("rejects empty information and empty query before dispatch", async () => {
    const executor = fakeExecutor();
    const vs = new VectorSearch(executor, "docs-main");
    await assert.rejects(() => vs.store({ information: "  " }), /non-empty/);
    await assert.rejects(() => vs.find({ query: "" }), /non-empty/);
    assert.equal(executor.calls.length, 0);
  });
});

describe("hashEmbedding / pointIdFor", () => {
  it("is deterministic, unit length, and EMBEDDING_DIM wide", () => {
    const a = hashEmbedding("the sky is blue");
    const b = hashEmbedding("the sky is blue");
    assert.deepEqual(a, b);
    assert.equal(a.length, EMBEDDING_DIM);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9);
  });
  it("differs for different texts", () => {
    assert.notDeepEqual(hashEmbedding("apples"), hashEmbedding("oranges"));
  });
  it("pointIdFor is deterministic and metadata-sensitive", () => {
    assert.equal(pointIdFor("hello"), pointIdFor("hello"));
    assert.notEqual(pointIdFor("hello"), pointIdFor("goodbye"));
    assert.notEqual(pointIdFor("hello"), pointIdFor("hello", { a: 1 }));
  });
});

// --- Qdrant REST executor over a fake fetch -------------------------------

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

describe("QdrantExecutor", () => {
  it("store ensures the collection (creating on 404) then upserts one point", async () => {
    const calls: RecordedCall[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      const call: RecordedCall = {
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      if (call.method === "GET" && call.url.endsWith("/collections/notes")) {
        return jsonResponse(404, { status: { error: "not found" } });
      }
      if (call.method === "PUT" && call.url.endsWith("/collections/notes")) {
        return jsonResponse(200, { result: true });
      }
      if (call.method === "PUT" && call.url.endsWith("/points")) {
        return jsonResponse(200, { result: { status: "acknowledged" } });
      }
      return jsonResponse(200, {});
    };
    const executor = new QdrantExecutor(fetchFn, "http://localhost:6333");
    await executor.store("notes", "the sky is blue", { source: "test" });
    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls.map((c) => c.method),
      ["GET", "PUT", "PUT"],
    );
    assert.deepEqual(calls[1].body, { vectors: { size: EMBEDDING_DIM, distance: "Cosine" } });
    const pointsBody = calls[2].body as {
      points: Array<{ id: number; vector: number[]; payload: Record<string, unknown> }>;
    };
    assert.equal(pointsBody.points.length, 1);
    assert.equal(pointsBody.points[0].vector.length, EMBEDDING_DIM);
    assert.equal(pointsBody.points[0].payload.information, "the sky is blue");
    assert.equal(pointsBody.points[0].payload.source, "test");
    assert.equal(pointsBody.points[0].id, pointIdFor("the sky is blue", { source: "test" }));
  });

  it("store skips creation when the collection already exists", async () => {
    const methods: string[] = [];
    const fetchFn: FetchFn = async (_url, init) => {
      methods.push(init?.method ?? "GET");
      return jsonResponse(200, { result: true });
    };
    const executor = new QdrantExecutor(fetchFn);
    await executor.store("notes", "hello");
    assert.deepEqual(methods, ["GET", "PUT"]); // GET exists-check, PUT points only
  });

  it("find POSTs a search with the query embedding and maps hits to information", async () => {
    const calls: RecordedCall[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      return jsonResponse(200, {
        result: [
          { id: 7, score: 0.91, payload: { information: "the sky is blue", source: "test" } },
        ],
      });
    };
    const executor = new QdrantExecutor(fetchFn);
    const out = (await executor.find("notes", "sky")) as Array<Record<string, unknown>>;
    assert.equal(calls[0].method, "POST");
    assert.ok(calls[0].url.endsWith("/collections/notes/points/search"));
    const body = calls[0].body as { vector: number[]; limit: number; with_payload: boolean };
    assert.equal(body.vector.length, EMBEDDING_DIM);
    assert.equal(body.with_payload, true);
    assert.equal(out[0].information, "the sky is blue");
    assert.equal(out[0].score, 0.91);
  });

  it("surfaces HTTP errors from the service", async () => {
    const fetchFn: FetchFn = async () => jsonResponse(500, "boom");
    const executor = new QdrantExecutor(fetchFn);
    await assert.rejects(() => executor.find("notes", "x"), /HTTP 500/);
  });
});
