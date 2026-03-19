export interface MetricDataPoint {
  timestamp: string;
  value: number;
  tags?: Record<string, string>;
}

export interface MetricQueryOptions {
  startTime?: string;
  endTime?: string;
  intervalMs?: number;
  aggregation?: "avg" | "sum" | "min" | "max" | "count";
}

const MAX_POINTS = 1440; // 24h at 1-minute resolution

export class MetricsCollector {
  private readonly buffers = new Map<string, MetricDataPoint[]>();
  private readonly gauges = new Map<string, number>();

  record(metric: string, value: number, tags?: Record<string, string>): void {
    const point: MetricDataPoint = {
      timestamp: new Date().toISOString(),
      value,
      tags,
    };

    let buf = this.buffers.get(metric);
    if (!buf) {
      buf = [];
      this.buffers.set(metric, buf);
    }
    buf.push(point);

    // Ring buffer: evict oldest when over limit
    if (buf.length > MAX_POINTS) {
      buf.splice(0, buf.length - MAX_POINTS);
    }

    // Update gauge to latest value
    this.gauges.set(metric, value);
  }

  query(metric: string, options?: MetricQueryOptions): MetricDataPoint[] {
    const buf = this.buffers.get(metric);
    if (!buf) return [];

    let points = [...buf];

    if (options?.startTime) {
      const start = new Date(options.startTime).getTime();
      points = points.filter(p => new Date(p.timestamp).getTime() >= start);
    }
    if (options?.endTime) {
      const end = new Date(options.endTime).getTime();
      points = points.filter(p => new Date(p.timestamp).getTime() <= end);
    }

    if (options?.intervalMs && options.aggregation) {
      return this.aggregate(points, options.intervalMs, options.aggregation);
    }

    return points;
  }

  gauge(metric: string): number | null {
    return this.gauges.get(metric) ?? null;
  }

  private aggregate(
    points: MetricDataPoint[],
    intervalMs: number,
    aggregation: "avg" | "sum" | "min" | "max" | "count"
  ): MetricDataPoint[] {
    if (points.length === 0) return [];

    const buckets = new Map<number, number[]>();

    for (const p of points) {
      const t = new Date(p.timestamp).getTime();
      const bucketKey = Math.floor(t / intervalMs) * intervalMs;
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = [];
        buckets.set(bucketKey, bucket);
      }
      bucket.push(p.value);
    }

    const result: MetricDataPoint[] = [];
    const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);

    for (const key of sortedKeys) {
      const values = buckets.get(key)!;
      let value: number;

      switch (aggregation) {
        case "avg":
          value = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case "sum":
          value = values.reduce((a, b) => a + b, 0);
          break;
        case "min":
          value = Math.min(...values);
          break;
        case "max":
          value = Math.max(...values);
          break;
        case "count":
          value = values.length;
          break;
      }

      result.push({
        timestamp: new Date(key).toISOString(),
        value,
      });
    }

    return result;
  }
}
