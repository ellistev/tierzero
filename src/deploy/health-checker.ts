export interface HealthCheckOptions {
  timeoutMs?: number;
  expectedStatus?: number;
  expectedBody?: string;
}

export interface WaitOptions extends HealthCheckOptions {
  maxWaitMs: number;
  intervalMs: number;
  retries: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  error?: string;
  checkedAt: string;
}

export interface HealthCheckFetcher {
  (url: string, options?: { signal?: AbortSignal }): Promise<{ status: number; text(): Promise<string> }>;
}

export class HealthChecker {
  private readonly fetcher: HealthCheckFetcher;

  constructor(fetcher?: HealthCheckFetcher) {
    this.fetcher = fetcher ?? (async (url, opts) => {
      const res = await fetch(url, { signal: opts?.signal });
      return { status: res.status, text: () => res.text() };
    });
  }

  async check(url: string, options?: HealthCheckOptions): Promise<HealthCheckResult> {
    const timeoutMs = options?.timeoutMs ?? 5000;
    const expectedStatus = options?.expectedStatus ?? 200;
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this.fetcher(url, { signal: controller.signal });
        clearTimeout(timer);
        const responseTimeMs = Date.now() - start;
        const body = await response.text();

        let healthy = response.status === expectedStatus;
        if (healthy && options?.expectedBody) {
          healthy = body.includes(options.expectedBody);
        }

        return {
          healthy,
          statusCode: response.status,
          responseTimeMs,
          checkedAt: new Date().toISOString(),
          ...(healthy ? {} : { error: `Expected status ${expectedStatus}, got ${response.status}` }),
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return {
        healthy: false,
        statusCode: null,
        responseTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async waitForHealthy(url: string, options: WaitOptions): Promise<boolean> {
    const deadline = Date.now() + options.maxWaitMs;
    let attempts = 0;

    while (attempts < options.retries && Date.now() < deadline) {
      const result = await this.check(url, options);
      if (result.healthy) return true;

      attempts++;
      if (attempts < options.retries && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, options.intervalMs));
      }
    }

    return false;
  }
}
