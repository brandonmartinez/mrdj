// Owner: Livingston (provider HTTP plumbing — rate-limit + backoff)
// Shared fetch helper for music providers. Retries on 429/503 with exponential
// backoff, honoring the Retry-After header when present. Keeps provider modules
// free of retry boilerplate so search/resolve read cleanly.

export interface BackoffOptions {
  /** Max attempts including the first. Default 4. */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (attempt n waits ~base * 2^n). Default 300. */
  baseDelayMs?: number;
  /** Cap on any single backoff wait. Default 8000. */
  maxDelayMs?: number;
  /** Injectable sleep (tests pass a no-op to avoid real waits). */
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([429, 503]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

/**
 * fetch with exponential backoff on 429/503. Network errors are retried too.
 * Throws the last error / a non-retryable response is returned to the caller.
 */
export async function fetchWithBackoff(
  url: string,
  init?: RequestInit,
  opts: BackoffOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 300;
  const maxDelayMs  = opts.maxDelayMs ?? 8_000;
  const sleep       = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(url, init);
    } catch (err) {
      lastErr = err;
    }

    if (res && !RETRYABLE.has(res.status)) return res;

    const isLast = attempt === maxAttempts - 1;
    if (isLast) {
      if (res) return res; // surface the last retryable response to the caller
      throw lastErr instanceof Error ? lastErr : new Error('fetch failed');
    }

    const retryAfter = res ? parseRetryAfter(res.headers.get('retry-after')) : null;
    const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
    await sleep(retryAfter ?? backoff);
  }

  // Unreachable, but satisfies the type checker.
  throw lastErr instanceof Error ? lastErr : new Error('fetch failed');
}
