/**
 * vectorsearch types.
 *
 * The core talks to the outside only through an injectable executor:
 * store one piece of information, find stored information for a query.
 * The default executor is backed by a Qdrant REST client over an
 * injectable fetch function, so every behaviour is testable offline.
 */

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;

/**
 * Anything that can store and retrieve information in a collection.
 * Tests inject a fake; production uses the Qdrant REST executor.
 */
export interface VectorExecutor {
  store(
    collection: string,
    information: string,
    metadata?: Record<string, unknown>,
  ): Promise<unknown>;
  find(collection: string, query: string): Promise<unknown>;
}

export interface StoreOptions {
  information: string;
  metadata?: Record<string, unknown>;
  collection_name?: string;
}

export interface FindOptions {
  query: string;
  collection_name?: string;
}
