export const DEFAULT_POLICY = Object.freeze({ maxSourceAgeMs: 3000, maxFutureSkewMs: 0 });
export const DEMO_TARGET = Object.freeze({ id: 'demo-nw-straight', label: '가상 교차로 01', intersectionId: 'DEMO-001', approach: 'NW', movement: 'STRAIGHT', mappingVersion: 'simulation-v1' });
const KNOWN_APPROACHES = new Set(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
const KNOWN_MOVEMENTS = new Set(['STRAIGHT', 'LEFT', 'UTURN', 'BUS', 'BICYCLE', 'PEDESTRIAN']);
const SUPPORTED_PHASES = new Set(['RED', 'GREEN']);

/** A clock discontinuity invalidates both existing data and in-flight requests.
 * Recovery establishes a new baseline, but cannot display data until a request
 * issued after that baseline has completed. The safe epoch never goes backwards
 * inside a session, including sub-tick wall-clock adjustments.
 */
export class ClockSession {
  constructor(wallMs, monotonicMs, maxDriftMs = 1500) {
    this.generation = 0;
    this.maxDriftMs = maxDriftMs;
    this.phase = 'invalid';
    this.resetExplicit(wallMs, monotonicMs);
  }

  _setBaseline(wallMs, monotonicMs, phase) {
    this.generation += 1;
    this.anchorWallMs = wallMs;
    this.anchorMonotonicMs = monotonicMs;
    this.lastWallMs = wallMs;
    this.lastMonotonicMs = monotonicMs;
    this.safeEpochMs = wallMs;
    this.phase = Number.isFinite(wallMs) && Number.isFinite(monotonicMs) ? phase : 'invalid';
  }

  resetExplicit(wallMs, monotonicMs) { this._setBaseline(wallMs, monotonicMs, 'ready'); }

  invalidate() {
    if (this.phase !== 'invalid') this.generation += 1;
    this.phase = 'invalid';
  }

  sample(wallMs, monotonicMs) {
    if (this.phase !== 'invalid') {
      const drift = (wallMs - this.anchorWallMs) - (monotonicMs - this.anchorMonotonicMs);
      if (!Number.isFinite(wallMs) || !Number.isFinite(monotonicMs) || wallMs < this.lastWallMs || monotonicMs < this.lastMonotonicMs || Math.abs(drift) > this.maxDriftMs) {
        this.invalidate();
      } else {
        this.safeEpochMs = Math.max(this.safeEpochMs, wallMs, this.anchorWallMs + (monotonicMs - this.anchorMonotonicMs));
        this.lastWallMs = wallMs;
        this.lastMonotonicMs = monotonicMs;
      }
    }
    return { valid: this.phase !== 'invalid', canDisplay: this.phase === 'ready', generation: this.generation, nowEpochMs: this.phase !== 'invalid' ? this.safeEpochMs : null, wallEpochMs: wallMs };
  }

  beginRequest(wallMs, monotonicMs) {
    const sample = this.sample(wallMs, monotonicMs);
    if (!sample.valid) this._setBaseline(wallMs, monotonicMs, 'recovering');
    return Object.freeze({ generation: this.generation });
  }

  acceptResponse(ticket, wallMs, monotonicMs) {
    if (!ticket || ticket.generation !== this.generation) return false;
    const sample = this.sample(wallMs, monotonicMs);
    if (!sample.valid || ticket.generation !== this.generation) return false;
    this.phase = 'ready';
    return true;
  }
}

export function unknown(reason, checks = {}, sourceTimestampMs = null) {
  return { canShowSignal: false, phase: null, remainingSeconds: null, reason, sourceTimestampMs, checks: { target: false, direction: false, freshness: false, phase: false, ...checks } };
}

function validTarget(target) {
  return target && typeof target.id === 'string' && target.id.length > 0 && typeof target.intersectionId === 'string' && target.intersectionId.length > 0 && KNOWN_APPROACHES.has(target.approach) && KNOWN_MOVEMENTS.has(target.movement) && typeof target.mappingVersion === 'string' && target.mappingVersion.length > 0;
}

export function sameTarget(a, b) {
  return validTarget(a) && validTarget(b) && ['id', 'intersectionId', 'approach', 'movement', 'mappingVersion'].every(k => a[k] === b[k]);
}

export function evaluateFrame(frame, expectedTarget, nowMs, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...options.policy };
  if (!Number.isFinite(nowMs)) return unknown('clock-invalid');
  if (!validTarget(expectedTarget)) return unknown('approach-unknown');
  if (!frame) return unknown('no-data');
  if (!frame.target || frame.target.intersectionId !== expectedTarget.intersectionId || frame.target.id !== expectedTarget.id || frame.target.mappingVersion !== expectedTarget.mappingVersion) return unknown('id-mismatch');
  if (!sameTarget(frame.target, expectedTarget)) return unknown('direction-mismatch', { target: true });
  const checks = { target: true, direction: true, freshness: false, phase: false };
  const sourceMs = frame.sourceTimestampMs;
  if (!Number.isSafeInteger(sourceMs) || sourceMs <= 0) return unknown('missing-timestamp', checks);
  const age = nowMs - sourceMs;
  if (age < -policy.maxFutureSkewMs) return unknown('future-timestamp', checks, sourceMs);
  if (age >= policy.maxSourceAgeMs) return unknown('stale', checks, sourceMs);
  checks.freshness = true;
  if (!SUPPORTED_PHASES.has(frame.phase)) return unknown('unsupported-phase', checks, sourceMs);
  if (!Number.isSafeInteger(frame.remainingDeciseconds) || frame.remainingDeciseconds <= 0 || frame.remainingDeciseconds > 36000) return unknown('invalid-remaining', checks, sourceMs);
  const expiresAt = sourceMs + frame.remainingDeciseconds * 100;
  if (!Number.isSafeInteger(expiresAt) || nowMs >= expiresAt) return unknown('expired', checks, sourceMs);
  checks.phase = true;
  return { canShowSignal: true, phase: frame.phase, remainingSeconds: Math.ceil((expiresAt - nowMs) / 1000), reason: 'valid-demo', sourceTimestampMs: sourceMs, expiresAtMs: Math.min(expiresAt, sourceMs + policy.maxSourceAgeMs), checks };
}

export function evaluateLiveFrame(frame, selectedTarget, approvedTargets, nowMs, policy = DEFAULT_POLICY) {
  if (!Array.isArray(approvedTargets) || !approvedTargets.some(t => sameTarget(t, selectedTarget))) return unknown('target-not-configured');
  if (!frame || frame.schemaVersion !== 1 || frame.source !== 'live') return unknown('upstream-invalid');
  if (frame.status !== 'verified') return unknown(typeof frame.reason === 'string' ? frame.reason : 'upstream-invalid');
  const decision = evaluateFrame(frame, selectedTarget, nowMs, { policy: { maxSourceAgeMs: Math.min(DEFAULT_POLICY.maxSourceAgeMs, Number(policy.maxSourceAgeMs) || DEFAULT_POLICY.maxSourceAgeMs), maxFutureSkewMs: 0 } });
  if (!decision.canShowSignal) return decision;
  if (!Number.isSafeInteger(frame.expiresAtMs) || frame.expiresAtMs !== frame.sourceTimestampMs + frame.remainingDeciseconds * 100) return unknown('upstream-invalid');
  return { ...decision, reason: 'verified' };
}

export const REASON_LABELS = Object.freeze({
  'no-data': '데이터 수신 대기', 'target-not-configured': '검증된 교차로 매핑이 아직 등록되지 않았습니다.', 'mapping-unverified': '대상 매핑 확인 필요', 'api-key-missing': '서버 API 연결 설정이 필요합니다.',
  'id-mismatch': '대상 매핑 불일치', 'direction-mismatch': '진행 방향 또는 대상 신호 불일치', 'approach-unknown': '접근 방향 확인 필요', 'missing-timestamp': '원천 시각 확인 불가',
  'future-timestamp': '원천 시각 오류', 'stale': '데이터 지연', 'missing-phase': '신호 상태 확인 불가', 'unsupported-phase': '지원하지 않는 신호 상태', 'missing-remaining': '잔여시간 확인 불가',
  'invalid-remaining': '잔여시간 확인 불가', 'expired': '신호시간 만료', 'ambiguous-data': '대상 신호가 하나로 확인되지 않았습니다.', 'upstream-timeout': '연결 응답 지연', 'upstream-unavailable': '연결 끊김',
  'upstream-invalid': '데이터 형식 확인 필요', 'rate-limited': '요청 대기 중', 'invalid-request': '대상 요청 확인 필요', 'clock-invalid': '시간 기준 확인 필요', 'background-resume': '화면 복귀 후 재수신 대기',
  'valid-demo': '시연 입력 확인', 'verified': '서버 검증 조건 확인',
});
