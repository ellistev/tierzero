import type { KnowledgeScope } from "./store";

export function normalizeScopeValue(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

export function normalizeKnowledgeScope(
  scope: KnowledgeScope | null | undefined,
): KnowledgeScope | undefined {
  if (!scope) return undefined;

  const normalized: KnowledgeScope = {
    tenant: normalizeScopeValue(scope.tenant),
    workflowType: normalizeScopeValue(scope.workflowType),
    queue: normalizeScopeValue(scope.queue),
  };

  return normalized.tenant || normalized.workflowType || normalized.queue
    ? normalized
    : undefined;
}

export function isScopeCompatible(
  entryScope: KnowledgeScope | null | undefined,
  requestedScope: KnowledgeScope | null | undefined,
): boolean {
  const entry = normalizeKnowledgeScope(entryScope);
  const requested = normalizeKnowledgeScope(requestedScope);
  if (!requested) return true;

  return matchesField(entry?.tenant, requested.tenant)
    && matchesField(entry?.workflowType, requested.workflowType)
    && matchesField(entry?.queue, requested.queue);
}

export function scoreScopeMatch(
  entryScope: KnowledgeScope | null | undefined,
  requestedScope: KnowledgeScope | null | undefined,
): number {
  const entry = normalizeKnowledgeScope(entryScope);
  const requested = normalizeKnowledgeScope(requestedScope);
  if (!requested) return 0;

  let score = 0;
  if (requested.tenant && entry?.tenant === requested.tenant) score += 100;
  if (requested.workflowType && entry?.workflowType === requested.workflowType) score += 20;
  if (requested.queue && entry?.queue === requested.queue) score += 10;
  return score;
}

export function mergeKnowledgeScope(
  baseScope: KnowledgeScope | null | undefined,
  overrideScope: KnowledgeScope | null | undefined,
): KnowledgeScope | undefined {
  return normalizeKnowledgeScope({
    tenant: overrideScope?.tenant ?? baseScope?.tenant,
    workflowType: overrideScope?.workflowType ?? baseScope?.workflowType,
    queue: overrideScope?.queue ?? baseScope?.queue,
  });
}

function matchesField(entryValue: string | undefined, requestedValue: string | undefined): boolean {
  if (!requestedValue) return true;
  if (!entryValue) return true;
  return entryValue === requestedValue;
}
