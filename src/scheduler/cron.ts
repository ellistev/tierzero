// Lightweight cron expression parser (no external dependencies).
// Supports standard 5-field format: minute hour day-of-month month day-of-week
// Field syntax: *, specific values, ranges (1-5), steps, lists (1,3,5)

interface CronField {
  values: Set<number>;
}

function parseField(field: string, min: number, max: number): CronField {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const [, range, stepStr] = stepMatch;
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;
      if (range !== "*") {
        const rangeParts = range.split("-");
        start = parseInt(rangeParts[0], 10);
        end = rangeParts.length > 1 ? parseInt(rangeParts[1], 10) : max;
      }
      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else if (part === "*") {
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
    } else if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return { values };
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6), // 0=Sunday
  };
}

/**
 * Check if a date matches a cron expression.
 */
export function matches(cronExpr: string, date: Date): boolean {
  const cron = parseCron(cronExpr);
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1; // 1-based
  const dayOfWeek = date.getUTCDay(); // 0=Sunday

  return (
    cron.minute.values.has(minute) &&
    cron.hour.values.has(hour) &&
    cron.dayOfMonth.values.has(dayOfMonth) &&
    cron.month.values.has(month) &&
    cron.dayOfWeek.values.has(dayOfWeek)
  );
}

/**
 * Calculate the next run time after a given date for a cron expression.
 * Searches minute-by-minute from the starting point.
 */
export function nextRun(cronExpr: string, after?: Date): Date {
  const cron = parseCron(cronExpr);
  // Start from the next minute after 'after'
  const start = after ? new Date(after.getTime()) : new Date();
  // Move to next minute, zero out seconds/ms
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  const candidate = new Date(start.getTime());

  // Search up to ~4 years ahead (to handle leap year edge cases)
  const maxIterations = 4 * 366 * 24 * 60;

  for (let i = 0; i < maxIterations; i++) {
    const month = candidate.getUTCMonth() + 1;
    if (!cron.month.values.has(month)) {
      // Skip to next month
      candidate.setUTCMonth(candidate.getUTCMonth() + 1, 1);
      candidate.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const dayOfMonth = candidate.getUTCDate();
    const dayOfWeek = candidate.getUTCDay();
    if (!cron.dayOfMonth.values.has(dayOfMonth) || !cron.dayOfWeek.values.has(dayOfWeek)) {
      // Skip to next day
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      candidate.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const hour = candidate.getUTCHours();
    if (!cron.hour.values.has(hour)) {
      // Skip to next hour
      candidate.setUTCHours(candidate.getUTCHours() + 1, 0, 0, 0);
      continue;
    }

    const minute = candidate.getUTCMinutes();
    if (!cron.minute.values.has(minute)) {
      // Skip to next minute
      candidate.setUTCMinutes(candidate.getUTCMinutes() + 1, 0, 0);
      continue;
    }

    return new Date(candidate.getTime());
  }

  throw new Error(`Could not find next run for cron expression: ${cronExpr}`);
}
