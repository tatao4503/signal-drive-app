import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSignal, unknownPacket } from '../server/normalize.mjs';
import { validateTargets } from '../server/config.mjs';

const NOW = 1_793_838_000_000;
const target = Object.freeze({ id: 'synthetic-test', label: '합성 테스트 대상', intersectionId: '20386', approach: 'SE', movement: 'STRAIGHT', mappingVersion: 'test-1', verified: true });
const row = (fields = {}) => ({ itstId: '20386', trsmUtcTime: NOW - 250, seStsgStatNm: 'protected-Movement-Allowed', seStsgRmdrCs: 354, ...fields });
function denied(packet, reason) {
  assert.equal(packet.status, 'unknown');
  assert.equal(packet.reason, reason);
  assert.equal(packet.phase, null);
  assert.equal(packet.remainingDeciseconds, null);
  assert.equal(packet.expiresAtMs, null);
}

test('선택한 대각 방향과 movement만 보존하고 원천 시각으로 만료를 계산한다', () => {
  const packet = normalizeSignal([row({ ntStsgRmdrCs: 999, ntStsgStatNm: 'stop-And-Remain', seLtsgRmdrCs: 900 })], target, NOW);
  assert.equal(packet.status, 'verified');
  assert.equal(packet.phase, 'GREEN');
  assert.equal(packet.remainingDeciseconds, 354);
  assert.equal(packet.expiresAtMs - NOW, 35_150);
  assert.equal(packet.target.approach, 'SE');
  assert.equal(packet.target.movement, 'STRAIGHT');
});

test('잔여시간만으로 녹색이나 황색을 만들지 않는다', () => {
  denied(normalizeSignal([row({ seStsgStatNm: null, seStsgRmdrCs: 20 })], target, NOW), 'missing-phase');
  const packet = normalizeSignal([row({ seStsgStatNm: 'stop-And-Remain', seStsgRmdrCs: 20 })], target, NOW);
  assert.equal(packet.phase, 'RED');
});

test('오래됨·미래·소실·다른 ID·잘못된 시간·상태·만료를 숨긴다', async t => {
  const cases = [
    ['stale', [row({ trsmUtcTime: NOW - 3000 })]],
    ['future-timestamp', [row({ trsmUtcTime: NOW + 1 })]],
    ['missing-timestamp', [row({ trsmUtcTime: null })]],
    ['missing-timestamp', [row({ trsmUtcTime: (NOW / 1000) })]],
    ['missing-timestamp', [row({ trsmUtcTime: 'NaN' })]],
    ['id-mismatch', [row({ itstId: '99999' })]],
    ['no-data', []],
    ['missing-phase', [row({ seStsgStatNm: null, ntStsgStatNm: 'protected-Movement-Allowed' })]],
    ['unsupported-phase', [row({ seStsgStatNm: 'permissive-Movement-Allowed' })]],
    ['unsupported-phase', [row({ seStsgStatNm: 'protected-clearance' })]],
    ['missing-remaining', [row({ seStsgRmdrCs: null })]],
    ['invalid-remaining', [row({ seStsgRmdrCs: -1 })]],
    ['invalid-remaining', [row({ seStsgRmdrCs: 35.4 })]],
    ['invalid-remaining', [row({ seStsgRmdrCs: 'Infinity' })]],
    ['invalid-remaining', [row({ seStsgRmdrCs: 36001 })]],
    ['expired', [row({ trsmUtcTime: NOW - 500, seStsgRmdrCs: 5 })]],
    ['expired', [row({ seStsgRmdrCs: 0 })]],
    ['upstream-invalid', { error: 'provider-error', data: [] }],
    ['upstream-invalid', [null]],
    ['upstream-invalid', Array(65).fill(row())],
    ['ambiguous-data', [row(), row({ seStsgStatNm: 'stop-And-Remain' })]],
  ];
  for (const [reason, input] of cases) await t.test(reason, () => denied(normalizeSignal(input, target, NOW), reason));
});

test('최신 원천 행을 선택하고 보행을 차량 상태로 반전하지 않는다', () => {
  const pedestrian = { ...target, movement: 'PEDESTRIAN', approach: 'NE' };
  const packet = normalizeSignal([
    row({ trsmUtcTime: NOW - 2000, nePdsgStatNm: 'protected-Movement-Allowed', nePdsgRmdrCs: 300 }),
    row({ trsmUtcTime: NOW - 100, nePdsgStatNm: 'stop-And-Remain', nePdsgRmdrCs: 120 }),
  ], pedestrian, NOW);
  assert.equal(packet.phase, 'RED');
  assert.equal(packet.remainingDeciseconds, 120);
});

test('브라우저가 승인하지 않은 매핑은 명시적으로 보류한다', () => {
  denied(normalizeSignal([row()], { ...target, verified: false }, NOW), 'mapping-unverified');
  denied(normalizeSignal([row()], { ...target, approach: 'BAD' }, NOW), 'mapping-unverified');
  denied(normalizeSignal([row()], target, NaN), 'clock-invalid');
  const unknown = unknownPacket(target, 'upstream-unavailable', NOW);
  assert.deepEqual(Object.keys(unknown).filter(k => /key|evidence|verifiedAt/i.test(k)), []);
});

test('registry는 서버 측 파일에서 엄격히 승인하고 검증 근거를 공개하지 않는다', () => {
  assert.equal(validateTargets([]).size, 0);
  assert.throws(() => validateTargets([{ ...target }]), /evidence/);
  const config = { ...target, verificationEvidence: 'mock evidence only', verifiedAt: '2026-11-05T00:00:00Z' };
  const validated = validateTargets([config]).get(target.id);
  assert.equal(validated.verified, true);
  assert.equal(validated.verificationEvidence, undefined);
  assert.throws(() => validateTargets([config, config]), /duplicate/);
  assert.throws(() => validateTargets([{ ...config, approach: '__proto__' }]), /approach/);
});
