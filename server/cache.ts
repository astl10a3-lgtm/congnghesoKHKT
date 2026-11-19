import { hashCanonicalPayload } from './security.ts';

export interface CacheRunResult<T> {
  value: T;
  cached: boolean;
  deduplicated: boolean;
  cacheKeyPrefix: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

/**
 * Bounded TTL LRU Cache with concurrent in-flight Promise coalescing.
 * Prevents duplicate concurrent AI / advisor invocations for identical requests
 * and returns cloned payloads so cached entries remain immutable.
 */
export class CoalescingTtlCache<T> {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(options?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = Math.max(4, options?.maxEntries ?? 48);
    this.ttlMs = Math.max(1000, options?.ttlMs ?? 10 * 60 * 1000);
  }

  private cloneValue(value: T): T {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value));
    }
  }

  private pruneExpired(now = Date.now()) {
    for (const [k, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(k);
      }
    }
  }

  getCached(key: string): T | null {
    const now = Date.now();
    const existing = this.store.get(key);
    if (!existing) return null;
    if (existing.expiresAt <= now) {
      this.store.delete(key);
      return null;
    }
    // Refresh LRU recency
    this.store.delete(key);
    this.store.set(key, existing);
    return this.cloneValue(existing.value);
  }

  setCached(key: string, value: T, customTtlMs?: number) {
    const now = Date.now();
    this.pruneExpired(now);
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, {
      value: this.cloneValue(value),
      createdAt: now,
      expiresAt: now + Math.max(1000, customTtlMs ?? this.ttlMs),
    });
  }

  async run(
    keyPayload: unknown,
    producer: () => Promise<T>,
    options?: { skipCache?: boolean; shouldCache?: (result: T) => boolean }
  ): Promise<CacheRunResult<T>> {
    const key = hashCanonicalPayload(keyPayload);
    const cacheKeyPrefix = key.slice(0, 12);

    if (!options?.skipCache) {
      const hit = this.getCached(key);
      if (hit !== null) {
        return {
          value: hit,
          cached: true,
          deduplicated: false,
          cacheKeyPrefix,
        };
      }
    }

    const existingFlight = this.inFlight.get(key);
    if (existingFlight) {
      const val = await existingFlight;
      return {
        value: this.cloneValue(val),
        cached: false,
        deduplicated: true,
        cacheKeyPrefix,
      };
    }

    const flight = producer()
      .then((result) => {
        const allowStore =
          !options?.skipCache && (options?.shouldCache ? options.shouldCache(result) : true);
        if (allowStore) {
          this.setCached(key, result);
        }
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, flight);
    const value = await flight;

    return {
      value: this.cloneValue(value),
      cached: false,
      deduplicated: false,
      cacheKeyPrefix,
    };
  }

  clear() {
    this.store.clear();
    this.inFlight.clear();
  }

  stats() {
    this.pruneExpired();
    return {
      entries: this.store.size,
      inFlightCount: this.inFlight.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    };
  }
}
