export const stableJson = (value: unknown): string => {
  const normalized = normalizeValue(value);
  if (normalized === undefined) {
    throw new TypeError('stableJson does not support undefined root values');
  }
  return JSON.stringify(normalized);
};

const normalizeValue = (value: unknown): unknown | undefined => {
  if (value === null) return null;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('stableJson does not support non-finite numbers');
    }
    return value;
  }
  if (valueType === 'bigint') {
    throw new TypeError('stableJson does not support bigint');
  }
  if (valueType === 'function') {
    throw new TypeError('stableJson does not support functions');
  }
  if (valueType === 'symbol') {
    throw new TypeError('stableJson does not support symbols');
  }
  if (valueType === 'undefined') {
    return undefined;
  }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      const normalized = normalizeValue(item);
      result.push(normalized === undefined ? null : normalized);
    }
    return result;
  }
  if (valueType === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const normalized = normalizeValue(record[key]);
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }
    return result;
  }
  throw new TypeError('stableJson does not support value');
};
