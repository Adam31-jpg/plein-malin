export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  onRetry?: (attempt: number, reason: string, delayMs: number) => void;
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`HTTP ${status} sur ${url}${body ? ` : ${body.slice(0, 200)}` : ""}`);
    this.name = "HttpError";
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch avec timeout et retry exponentiel (+ jitter) sur les erreurs réseau,
 * timeouts et statuts transitoires (429, 5xx). Respecte `Retry-After` si présent.
 */
export async function fetchWithRetry(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<Response> {
  const { retries = 4, baseDelayMs = 1000, timeoutMs = 30_000, onRetry } = opts;

  for (let attempt = 0; ; attempt++) {
    let reason: string;
    let retryAfterMs: number | undefined;
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      const body = await res.text().catch(() => "");
      if (!RETRYABLE_STATUS.has(res.status) || attempt >= retries) throw new HttpError(res.status, url, body);
      reason = `HTTP ${res.status}`;
      const header = res.headers.get("retry-after");
      if (header && !Number.isNaN(Number(header))) retryAfterMs = Number(header) * 1000;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (attempt >= retries) throw err;
      reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    const backoff = baseDelayMs * 2 ** attempt;
    const delayMs = Math.min(retryAfterMs ?? backoff + Math.random() * backoff * 0.3, 60_000);
    onRetry?.(attempt + 1, reason, delayMs);
    await sleep(delayMs);
  }
}
