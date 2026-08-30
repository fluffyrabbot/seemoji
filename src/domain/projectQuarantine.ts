const QUARANTINE_FORMAT = 'seemoji-quarantined-project';
const QUARANTINE_SCHEMA_VERSION = 1;

export interface ProjectQuarantineRecord {
  readonly recordId: string | null;
  readonly error: string;
  readonly contentHash: string;
  readonly byteSize: number;
  readonly encodedRecord: unknown;
}

export interface ProjectQuarantineExport extends ProjectQuarantineRecord {
  readonly format: typeof QUARANTINE_FORMAT;
  readonly schemaVersion: typeof QUARANTINE_SCHEMA_VERSION;
  readonly exportedAt: number;
  readonly encoding: 'seemoji-structured-json-v1';
}

const encode = (
  value: unknown,
  seen: Set<object>,
): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value) && !Object.is(value, -0)) return value;
    return { $type: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
  }
  if (typeof value === 'undefined') return { $type: 'undefined' };
  if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };
  if (typeof value !== 'object') return { $type: typeof value, value: String(value) };

  if (seen.has(value)) return { $type: 'reference' };
  seen.add(value);

  if (value instanceof Date) {
    return { $type: 'date', value: Number.isNaN(value.getTime()) ? null : value.toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => encode(entry, seen));
  }

  const source = value as Record<string, unknown>;
  const encoded: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    encoded[key] = encode(source[key], seen);
  }
  return encoded;
};

const hashContent = (content: string): { readonly contentHash: string; readonly byteSize: number } => {
  const encoded = new TextEncoder().encode(content);
  let hash = 2_166_136_261;
  for (const byte of encoded) hash = Math.imul(hash ^ byte, 16_777_619);
  return {
    contentHash: `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`,
    byteSize: encoded.byteLength,
  };
};

export function createProjectQuarantineRecord(
  rawRecord: unknown,
  error: string,
): ProjectQuarantineRecord {
  const encodedRecord = encode(rawRecord, new Set());
  const canonical = JSON.stringify(encodedRecord);
  const fingerprint = hashContent(canonical);
  const raw = rawRecord !== null && typeof rawRecord === 'object' && !Array.isArray(rawRecord)
    ? rawRecord as Record<string, unknown> : null;
  return {
    recordId: typeof raw?.id === 'string' && raw.id ? raw.id : null,
    error,
    ...fingerprint,
    encodedRecord,
  };
}

export function sameProjectQuarantineRecord(
  left: ProjectQuarantineRecord,
  right: ProjectQuarantineRecord,
): boolean {
  return left.contentHash === right.contentHash
    && JSON.stringify(left.encodedRecord) === JSON.stringify(right.encodedRecord);
}

export function createProjectQuarantineExport(
  record: ProjectQuarantineRecord,
  exportedAt: number,
): ProjectQuarantineExport {
  if (!Number.isFinite(exportedAt) || exportedAt < 0) {
    throw new RangeError('Quarantine export timestamp is invalid');
  }
  return {
    format: QUARANTINE_FORMAT,
    schemaVersion: QUARANTINE_SCHEMA_VERSION,
    exportedAt,
    encoding: 'seemoji-structured-json-v1',
    ...record,
  };
}
