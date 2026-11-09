/**
 * Schema Sanitizer for Google Gemini API.
 * Converts arbitrary JSON Schemas (including Zod-generated schemas with $ref/definitions)
 * into the strict OpenAPI 3.0 schema subset required by Gemini's generation_config.response_schema.
 */

function deepClone<T>(val: T): T {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(deepClone) as unknown as T;
  }
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    copy[k] = deepClone(v);
  }
  return copy as T;
}

/**
 * Extracts and maps all definitions from definitions or $defs.
 */
function collectDefinitions(
  root: Record<string, unknown>,
  defMap: Map<string, unknown>,
): void {
  const defBlocks = [
    root.definitions as Record<string, unknown> | undefined,
    root.$defs as Record<string, unknown> | undefined,
  ];

  for (const block of defBlocks) {
    if (block && typeof block === 'object') {
      for (const [name, def] of Object.entries(block)) {
        defMap.set(name, def);
        defMap.set(`#/definitions/${name}`, def);
        defMap.set(`#/$defs/${name}`, def);
      }
    }
  }
}

/**
 * Recursively inlines all $ref pointers using defMap.
 */
function inlineRefs(
  node: unknown,
  defMap: Map<string, unknown>,
  seenRefs = new Set<string>(),
): unknown {
  if (node === null || typeof node !== 'object') {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => inlineRefs(item, defMap, seenRefs));
  }

  const obj = { ...(node as Record<string, unknown>) };

  if (typeof obj.$ref === 'string') {
    const ref = obj.$ref;
    const cleanRef = ref.replace(/^#\/(definitions|\$defs)\//, '');
    const target = defMap.get(ref) || defMap.get(cleanRef);

    if (target && !seenRefs.has(ref)) {
      const nextSeen = new Set(seenRefs);
      nextSeen.add(ref);
      const inlinedTarget = inlineRefs(deepClone(target), defMap, nextSeen);
      delete obj.$ref;
      if (inlinedTarget && typeof inlinedTarget === 'object' && !Array.isArray(inlinedTarget)) {
        return inlineRefs({ ...inlinedTarget, ...obj }, defMap, nextSeen);
      }
      return inlinedTarget;
    }
    delete obj.$ref;
  }

  for (const [key, value] of Object.entries(obj)) {
    obj[key] = inlineRefs(value, defMap, seenRefs);
  }

  return obj;
}

/**
 * Normalizes union types, anyOf/oneOf with null into nullable: true,
 * converts const to enum, and cleans keywords.
 */
function normalizeTypeAndUnions(obj: Record<string, unknown>): Record<string, unknown> {
  const res = { ...obj };

  // Convert const to single-value enum
  if ('const' in res && res.const !== undefined) {
    res.enum = [res.const];
    delete res.const;
  }

  // Handle anyOf / oneOf with null
  const union = (res.anyOf || res.oneOf) as unknown[];
  if (Array.isArray(union) && union.length > 0) {
    const isNullBranch = (b: unknown) =>
      b !== null &&
      typeof b === 'object' &&
      ((b as any).type === 'null' || (Array.isArray((b as any).type) && (b as any).type.includes('null')));

    const hasNull = union.some(isNullBranch);
    const nonNullBranches = union.filter((b) => !isNullBranch(b));

    if (hasNull) {
      res.nullable = true;
    }

    if (nonNullBranches.length === 1 && typeof nonNullBranches[0] === 'object' && nonNullBranches[0] !== null) {
      const branch = nonNullBranches[0] as Record<string, unknown>;
      delete res.anyOf;
      delete res.oneOf;
      Object.assign(res, branch);
    } else if (nonNullBranches.every((b) => typeof b === 'object' && b !== null && Array.isArray((b as any).enum))) {
      // If all branches are enum branches, merge enums
      const combinedEnum = Array.from(new Set(nonNullBranches.flatMap((b) => (b as any).enum)));
      res.enum = combinedEnum;
      delete res.anyOf;
      delete res.oneOf;
    }
  }

  // Handle type array containing null: type: ["string", "null"] -> type: "string", nullable: true
  if (Array.isArray(res.type)) {
    const types = res.type as string[];
    if (types.includes('null')) {
      res.nullable = true;
    }
    const nonNullTypes = types.filter((t) => t !== 'null');
    res.type = nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes[0] || 'object';
  }

  return res;
}

/**
 * Recursively sanitizes a schema node for Gemini's OpenAPI subset.
 */
function sanitizeSchemaNode(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') {
    return raw;
  }

  if (Array.isArray(raw)) {
    return raw.map(sanitizeSchemaNode);
  }

  const normalized = normalizeTypeAndUnions(raw as Record<string, unknown>);
  const clean: Record<string, unknown> = {};

  // Infer type if missing
  if (!normalized.type) {
    if (normalized.properties && typeof normalized.properties === 'object') {
      normalized.type = 'object';
    } else if (normalized.items) {
      normalized.type = 'array';
    }
  }

  if (typeof normalized.type === 'string') {
    clean.type = normalized.type.toLowerCase();
  }

  // Properties: sanitize each property child WITHOUT dropping child property names
  if (normalized.properties && typeof normalized.properties === 'object' && !Array.isArray(normalized.properties)) {
    const cleanProps: Record<string, unknown> = {};
    for (const [propName, propSchema] of Object.entries(normalized.properties)) {
      cleanProps[propName] = sanitizeSchemaNode(propSchema);
    }
    clean.properties = cleanProps;
  }

  // Required: ensure every entry exists in clean.properties at this level
  if (Array.isArray(normalized.required)) {
    if (clean.properties && typeof clean.properties === 'object') {
      const validProps = new Set(Object.keys(clean.properties));
      const validRequired = normalized.required.filter(
        (reqKey: unknown) => typeof reqKey === 'string' && validProps.has(reqKey),
      );
      if (validRequired.length > 0) {
        clean.required = validRequired;
      }
    }
  }

  // Items for arrays
  if (normalized.items) {
    clean.items = sanitizeSchemaNode(normalized.items);
  }

  // Enums
  if (Array.isArray(normalized.enum)) {
    clean.enum = normalized.enum;
  }

  // Scalar annotations and constraints allowed by Gemini
  if (typeof normalized.description === 'string') {
    clean.description = normalized.description;
  }
  if (typeof normalized.format === 'string') {
    clean.format = normalized.format;
  }
  if (normalized.nullable === true) {
    clean.nullable = true;
  }
  if (typeof normalized.minimum === 'number') {
    clean.minimum = normalized.minimum;
  }
  if (typeof normalized.maximum === 'number') {
    clean.maximum = normalized.maximum;
  }
  if (typeof normalized.minItems === 'number') {
    clean.minItems = normalized.minItems;
  }
  if (typeof normalized.maxItems === 'number') {
    clean.maxItems = normalized.maxItems;
  }

  return clean;
}

/**
 * Public Sanitizer for Gemini response schemas.
 * Inlines all $ref / definitions, drops unsupported keywords, converts const / anyOf null,
 * and validates that required properties exist at that level.
 */
export function sanitizeGeminiSchema(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') {
    return raw;
  }

  const rootClone = deepClone(raw) as Record<string, unknown>;
  const defMap = new Map<string, unknown>();
  collectDefinitions(rootClone, defMap);

  // 1. Inline all $ref pointers
  const inlined = inlineRefs(rootClone, defMap);

  // 2. Remove top-level schema metadata keywords that Gemini rejects
  if (inlined && typeof inlined === 'object') {
    delete (inlined as any).$schema;
    delete (inlined as any).$defs;
    delete (inlined as any).definitions;
    delete (inlined as any).title;
    delete (inlined as any).$id;
  }

  // 3. Recursively sanitize all nodes
  return sanitizeSchemaNode(inlined);
}

