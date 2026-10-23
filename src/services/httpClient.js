/**
 * Shared JSON fetch for every GIS service.
 *
 * Resolves with { data, meta } where meta records provenance:
 *   service, url, retrievedAt (ISO), durationMs, cache
 * cache is one of:
 *   'live'     fetched just now
 *   'session'  reused from this browser session (same request)
 *   'stored'   live request failed; last successful copy from localStorage
 * Throws an Error whose message names the service and the failure.
 */

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 2500;
const STORE_PREFIX = 'sungrid.http.v1:';
const STORE_INDEX = 'sungrid.http.v1.index';
const STORE_MAX_ENTRIES = 60;
const STORE_MAX_CHARS = 1_500_000;

const sessionCache = new Map();

export function clearSessionCache() {
  sessionCache.clear();
}

export function fetchJson(service, url, options = {}) {
  const key = `${options.method || 'GET'} ${url} ${options.body ?? ''}`;
  const cached = sessionCache.get(key);
  if (cached) {
    return cached.then(({ data, meta }) => ({
      data,
      meta: { ...meta, cache: meta.cache === 'live' ? 'session' : meta.cache, durationMs: 0 },
    }));
  }

  const pending = fetchWithFallback(service, url, key, options);
  let settled = false;
  const evict = () => sessionCache.get(key) === pending && sessionCache.delete(key);
  sessionCache.set(key, pending);
  pending.then(
    (r) => {
      settled = true;
      // A fallback copy is not cached, so the next request tries live again.
      if (r.meta.cache === 'stored') evict();
    },
    () => {
      settled = true;
      evict();
    }
  );
  // A request cancelled mid-flight must not be joined by the next run; aborting
  // after it already succeeded (e.g. a finished run) keeps the cached result.
  options.signal?.addEventListener('abort', () => settled || evict(), { once: true });
  return pending;
}

async function fetchWithFallback(service, url, key, options) {
  const started = Date.now();
  try {
    const data = await fetchWithRetry(service, url, options);
    const meta = {
      service,
      url: displayUrl(options.sourceUrl ?? url, options),
      retrievedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      cache: 'live',
    };
    storePut(key, { data, meta });
    return { data, meta };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    const stored = options.storedFallback === false ? null : storeGet(key);
    if (stored) {
      return {
        data: stored.data,
        meta: { ...stored.meta, cache: 'stored', durationMs: Date.now() - started, liveError: err.message },
      };
    }
    throw err;
  }
}

// GET urls are shown as-is; POST bodies (Overpass) are appended for traceability.
function displayUrl(url, options) {
  if (!options.body) return url;
  return `${url} (POST ${String(options.body).slice(0, 300)})`;
}

async function fetchWithRetry(service, url, { retries = 1, retryOnTimeout = false, ...options }, attempt = 0) {
  try {
    return await fetchOnce(service, url, options);
  } catch (err) {
    const retry = err.retryable || (retryOnTimeout && err.timedOut);
    if (attempt < retries && retry && !options.signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
      return fetchWithRetry(service, url, { retries, retryOnTimeout, ...options }, attempt + 1);
    }
    throw err;
  }
}

const tagged = (message, tags) => Object.assign(new Error(message), tags);

async function fetchOnce(service, url, { timeoutMs = 20000, signal, method, body, headers }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  let response;
  try {
    response = await fetch(url, { method, body, headers, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw tagged(`${service} timed out after ${timeoutMs / 1000}s`, { timedOut: true });
    if (signal?.aborted) throw new Error(`${service} request cancelled`);
    throw tagged(`${service} unreachable (network or CORS error): ${err.message}`, { retryable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }

  if (!response.ok) {
    const message = `${service} returned HTTP ${response.status} ${response.statusText}`.trim();
    throw tagged(message, { retryable: RETRY_STATUS.has(response.status) });
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${service} returned a non-JSON response`);
  }
  // ArcGIS reports query errors (including throttling) as HTTP 200 with an { error } body.
  if (data?.error) {
    const code = Number(data.error.code);
    throw tagged(`${service} error ${data.error.code ?? ''}: ${data.error.message ?? 'unknown error'}`, {
      retryable: RETRY_STATUS.has(code),
    });
  }
  return data;
}

// ---- localStorage fallback copy (best effort; unavailable storage is ignored) ----

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function hashKey(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + key.length.toString(36);
}

function storeGet(key) {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(STORE_PREFIX + hashKey(key));
    const entry = raw && JSON.parse(raw);
    return entry?.key === key ? entry.value : null;
  } catch {
    return null;
  }
}

function storePut(key, value) {
  const ls = storage();
  if (!ls) return;
  try {
    const text = JSON.stringify({ key, value });
    if (text.length > STORE_MAX_CHARS) return;
    const id = hashKey(key);
    const index = JSON.parse(ls.getItem(STORE_INDEX) || '[]').filter((k) => k !== id);
    index.push(id);
    while (index.length > STORE_MAX_ENTRIES) ls.removeItem(STORE_PREFIX + index.shift());
    for (;;) {
      try {
        ls.setItem(STORE_PREFIX + id, text);
        break;
      } catch {
        // Quota: drop the oldest entry and try again, or give up.
        if (index.length <= 1) return;
        ls.removeItem(STORE_PREFIX + index.shift());
      }
    }
    ls.setItem(STORE_INDEX, JSON.stringify(index));
  } catch {
    // Storage is a convenience; failures never affect the assessment.
  }
}
