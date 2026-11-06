/**
 * Recursively scans an object, array, or primitive to ensure no NaN or Infinity exists.
 */
export function assertNoNaN(value: unknown, path = 'root'): void {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      throw new Error(`Found NaN at ${path}`);
    }
    if (!Number.isFinite(value)) {
      throw new Error(`Found non-finite number (${value}) at ${path}`);
    }
    return;
  }

  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoNaN(value[i], `${path}[${i}]`);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      assertNoNaN(val, `${path}.${key}`);
    }
  }
}

/**
 * Recursively freezes an object graph to test immutability.
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  Object.freeze(obj);

  for (const key of Object.getOwnPropertyNames(obj)) {
    const prop = (obj as Record<string, unknown>)[key];
    if (prop !== null && (typeof prop === 'object' || typeof prop === 'function')) {
      if (!Object.isFrozen(prop)) {
        deepFreeze(prop);
      }
    }
  }

  return obj;
}

