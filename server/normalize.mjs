/** Seoul current-phase adapter. No phase is inferred from a remaining-time value. */
export const DEFAULT_POLICY = Object.freeze({
  maxSourceAgeMs: 3_000,
  maxFutureSkewMs: 0,
  maxRemainingDeciseconds: 36_000,
});

export const APPROACH_PREFIX = Object.freeze({
  N: 'nt', NE: 'ne', E: 'et', SE: 'se', S: 'st', SW: 'sw', W: 'wt', NW: 'nw',
});
export const MOVEMENT_PREFIX = Object.freeze({
  STRAIGHT: 'Stsg', LEFT: 'Ltsg', UTURN: 'Utsg', BUS: 'Bssg', BICYCLE: 'Bcsg', PEDESTRIAN: 'Pdsg',
});

// v0.1 deliberately does not guess clearance, flashing, permissive, or unknown states.
const DOCUMENTED_PHASES = new Map([
  ['stop-And-Remain', 'RED'],
  ['protected-Movement-Allowed', 'GREEN'],
]);

export function publicTarget(target) {
  if (!target) return null;
  return {
    id: target.id,
    label: target.label,
    intersectionId: target.intersectionId,
    approach: target.approach,
    movement: target.movement,
    mappingVersion: target.mappingVersion,
  };
}

export function unknownPacket(target, reason, nowMs = Date.now(), sourceTimestampMs = null) {
  return {
    schemaVersion: 1,
    status: 'unknown',
    reason,
    target: publicTarget(target),
    source: 'live',
    sourceTimestampMs,
    receivedAtMs: Number.isSafeInteger(nowMs) ? nowMs : null,
    phase: null,
    remainingDeciseconds: null,
    expiresAtMs: null,
  };
}

export function parseSourceTimestamp(value) {
  if (typeof value === 'string' && !/^\d{13}$/.test(value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp >= 1_000_000_000_000
    ? timestamp : null;
}

function remainingValue(value) {
  if (typeof value === 'string' && !/^\d+(?:\.0+)?$/.test(value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const remaining = Number(value);
  return Number.isSafeInteger(remaining) ? remaining : null;
}

/** Supported envelope shapes are explicit; an error object is never an empty success. */
export function extractRows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object' || data.error || data.errorCode) return null;
  if (Array.isArray(data.result)) return data.result;
  if (Array.isArray(data.data)) return data.data;
  return null;
}

export function normalizeSignal(data, target, nowMs = Date.now(), policy = DEFAULT_POLICY) {
  const deny = (reason, sourceTimestampMs = null) => unknownPacket(target, reason, nowMs, sourceTimestampMs);
  if (!Number.isSafeInteger(nowMs) || nowMs < 1_000_000_000_000) return deny('clock-invalid');
  if (!target || target.verified !== true) return deny('mapping-unverified');
  const prefix = APPROACH_PREFIX[target.approach];
  const movement = MOVEMENT_PREFIX[target.movement];
  if (!prefix || !movement) return deny('mapping-unverified');

  const rows = extractRows(data);
  if (!rows || rows.length > 64 || !rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) return deny('upstream-invalid');
  if (rows.length === 0) return deny('no-data');
  const matching = rows.filter(row => String(row.itstId) === target.intersectionId);
  if (!matching.length) return deny('id-mismatch');
  const timestamps = matching.map(row => parseSourceTimestamp(row.trsmUtcTime));
  if (timestamps.some(timestamp => timestamp === null)) return deny('missing-timestamp');
  const latestTimestamp = Math.max(...timestamps);
  const latest = matching.filter((_, index) => timestamps[index] === latestTimestamp);
  const phaseField = `${prefix}${movement}StatNm`;
  const remainingField = `${prefix}${movement}RmdrCs`;
  if (latest.some(row => row[phaseField] !== latest[0][phaseField] || row[remainingField] !== latest[0][remainingField])) {
    return deny('ambiguous-data', latestTimestamp);
  }
  const row = latest[0];
  const ageMs = nowMs - latestTimestamp;
  if (ageMs < -policy.maxFutureSkewMs) return deny('future-timestamp', latestTimestamp);
  if (ageMs >= policy.maxSourceAgeMs) return deny('stale', latestTimestamp);
  const rawPhase = row[phaseField];
  if (rawPhase === null || rawPhase === undefined || rawPhase === '') return deny('missing-phase', latestTimestamp);
  const phase = DOCUMENTED_PHASES.get(rawPhase);
  if (!phase) return deny('unsupported-phase', latestTimestamp);
  const rawRemaining = row[remainingField];
  if (rawRemaining === null || rawRemaining === undefined || rawRemaining === '') return deny('missing-remaining', latestTimestamp);
  const remainingDeciseconds = remainingValue(rawRemaining);
  if (remainingDeciseconds === null || remainingDeciseconds < 0 || remainingDeciseconds > policy.maxRemainingDeciseconds) {
    return deny('invalid-remaining', latestTimestamp);
  }
  const expiresAtMs = latestTimestamp + remainingDeciseconds * 100;
  if (remainingDeciseconds === 0 || expiresAtMs <= nowMs) return deny('expired', latestTimestamp);
  return {
    schemaVersion: 1,
    status: 'verified',
    reason: 'verified',
    target: publicTarget(target),
    source: 'live',
    sourceTimestampMs: latestTimestamp,
    receivedAtMs: nowMs,
    phase,
    remainingDeciseconds,
    expiresAtMs,
  };
}
