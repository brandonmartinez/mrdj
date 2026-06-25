// Owner: Livingston (provider HTTP plumbing — rate-limit + backoff)
// Shared fetch helper for music providers. Retries on 429/503 with exponential
// backoff, honoring a clamped Retry-After header when present. Keeps provider
// modules free of retry boilerplate so search/resolve read cleanly.

export interface BackoffOptions {
  /** Max attempts including the first. Default 4. */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (attempt n waits ~base * 2^n). Default 300. */
  baseDelayMs?: number;
  /** Cap on any single exponential backoff wait. Default 2000. */
  maxDelayMs?: number;
  /** Cap on a provider-supplied Retry-After wait. Default maxDelayMs. */
  retryAfterMaxMs?: number;
  /** Maximum cumulative sleep across retries. Default 3000. */
  maxTotalBackoffMs?: number;
  /** Per-attempt fetch timeout. Default 4000. */
  attemptTimeoutMs?: number;
  /** Total wall-clock budget across attempts and sleeps. Default 9000. */
  totalTimeoutMs?: number;
  /** Injectable sleep (tests pass a no-op to avoid real waits). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable fetch (tests pass a stub to avoid the network). */
  fetch?: typeof fetch;
}

const RETRYABLE = new Set([429, 503]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type MusicProviderHttpErrorCode =
  | 'timeout'
  | 'retry_exhausted'
  | 'backoff_budget_exhausted'
  | 'fetch_failed';

export class MusicProviderHttpError extends Error {
  readonly code: MusicProviderHttpErrorCode;
  readonly status?: number;

  constructor(message: string, opts: { code: MusicProviderHttpErrorCode; status?: number; cause?: unknown }) {
    super(message);
    this.name = 'MusicProviderHttpError';
    this.code = opts.code;
    this.status = opts.status;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, when - now);
  return null;
}

function timeoutSignal(parent: AbortSignal | null | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutError = new MusicProviderHttpError(`music provider fetch timed out after ${timeoutMs}ms`, {
    code: 'timeout',
  });

  const onAbort = () => {
    controller.abort(parent?.reason);
  };

  if (parent?.aborted) {
    controller.abort(parent.reason);
  } else {
    parent?.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Fetch with bounded timeout and exponential backoff on 429/503. Network errors
 * are retried too. Throws typed errors for timeout / exhausted retry budgets; a
 * non-retryable response is returned to the caller.
 */
export async function fetchWithBackoff(
  url: string,
  init?: RequestInit,
  opts: BackoffOptions = {},
): Promise<Response> {
  const maxAttempts        = opts.maxAttempts ?? 4;
  const baseDelayMs        = opts.baseDelayMs ?? 300;
  const maxDelayMs         = opts.maxDelayMs ?? 2_000;
  const retryAfterMaxMs    = opts.retryAfterMaxMs ?? maxDelayMs;
  const maxTotalBackoffMs  = opts.maxTotalBackoffMs ?? 3_000;
  const attemptTimeoutMs   = opts.attemptTimeoutMs ?? 4_000;
  const totalTimeoutMs     = opts.totalTimeoutMs ?? 9_000;
  const sleep              = opts.sleep ?? defaultSleep;
  const fetchFn            = opts.fetch ?? fetch;

  let lastErr: unknown;
  let sleptMs = 0;
  const startedAt = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response | undefined;
    const remainingBudgetMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingBudgetMs <= 0) {
      throw new MusicProviderHttpError(`music provider total timeout exceeded after ${totalTimeoutMs}ms`, {
        code: 'timeout',
        cause: lastErr,
      });
    }

    const attemptTimeout = Math.min(attemptTimeoutMs, remainingBudgetMs);
    const bounded = timeoutSignal(init?.signal, attemptTimeout);
    try {
      res = await fetchFn(url, { ...init, signal: bounded.signal });
    } catch (err) {
      lastErr = bounded.signal.aborted && bounded.signal.reason instanceof MusicProviderHttpError
        ? bounded.signal.reason
        : err;
    } finally {
      bounded.cleanup();
    }

    if (res && !RETRYABLE.has(res.status)) return res;

    const isLast = attempt === maxAttempts - 1;
    if (isLast) {
      if (res) {
        throw new MusicProviderHttpError(`music provider retry attempts exhausted (${res.status})`, {
          code: 'retry_exhausted',
          status: res.status,
        });
      }
      throw lastErr instanceof Error
        ? lastErr
        : new MusicProviderHttpError('music provider fetch failed', { code: 'fetch_failed', cause: lastErr });
    }

    const retryAfter = res ? parseRetryAfter(res.headers.get('retry-after')) : null;
    const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
    const delay = retryAfter === null
      ? backoff
      : Math.min(retryAfter, retryAfterMaxMs, maxDelayMs);

    const budgetLeft = totalTimeoutMs - (Date.now() - startedAt);
    const backoffLeft = maxTotalBackoffMs - sleptMs;
    if (delay > budgetLeft || backoffLeft <= 0 || delay > backoffLeft) {
      throw new MusicProviderHttpError('music provider retry backoff budget exhausted', {
        code: 'backoff_budget_exhausted',
        status: res?.status,
        cause: lastErr,
      });
    }

    sleptMs += delay;
    await sleep(delay);
  }

  // Unreachable, but satisfies the type checker.
  throw lastErr instanceof Error
    ? lastErr
    : new MusicProviderHttpError('music provider fetch failed', { code: 'fetch_failed', cause: lastErr });
}
