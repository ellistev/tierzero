/**
 * Deep clone a value using structured clone.
 */
export function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

/**
 * Get the static `type` string from an instance's constructor.
 */
export function getTypeName(instance: unknown): string {
  const ctor = (instance as Record<string, unknown>)?.constructor as { type?: string; name?: string } | undefined;
  if (ctor?.type) return ctor.type;
  throw new Error(`No static 'type' on ${ctor?.name ?? "unknown"}`);
}
