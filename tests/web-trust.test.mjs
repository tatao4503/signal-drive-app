import test from 'node:test';
import assert from 'node:assert/strict';
import { ClockSession, DEMO_TARGET, evaluateFrame, evaluateLiveFrame, unknown } from '../web/trust.mjs';

const T = 1793860000000;
const makeFrame = (changes = {}) => ({ schemaVersion: 1, status: 'verified', source: 'live', target: { ...DEMO_TARGET }, sourceTimestampMs: T, remainingDeciseconds: 150, expiresAtMs: T + 15000, phase: 'RED', ...changes });
function assertUnknown(decision) {
  assert.equal(decision.canShowSignal, false);
  assert.equal(decision.phase, null);
  assert.equal(decision.remainingSeconds, null);
}
function sessionDecision(clock, frame, wall, monotonic) {
  const sample = clock.sample(wall, monotonic);
  return sample.canDisplay ? evaluateLiveFrame(frame, DEMO_TARGET, [DEMO_TARGET], sample.nowEpochMs) : unknown('clock-invalid');
}

test('one-second wall regression cannot resurrect a stale live observation', () => {
  const clock = new ClockSession(T, 0);
  const frame = makeFrame();
  assert.equal(sessionDecision(clock, frame, T + 2000, 2000).canShowSignal, true);
  assert.equal(sessionDecision(clock, frame, T + 3100, 3100).reason, 'stale');
  assert.equal(sessionDecision(clock, frame, T + 2100, 3200).reason, 'clock-invalid');
  assertUnknown(sessionDecision(clock, frame, T + 2200, 3300));
  assert.equal(clock.phase, 'invalid');
});

test('every absolute wall regression invalidates even when it is smaller than drift tolerance', () => {
  const clock = new ClockSession(T, 0);
  assert.equal(clock.sample(T + 100, 100).canDisplay, true);
  assert.equal(clock.sample(T + 99, 110).valid, false);
  assert.equal(clock.sample(T + 200, 220).canDisplay, false);
});

test('a sub-tick clock correction cannot reduce the source age floor', () => {
  const clock = new ClockSession(T, 0);
  assert.equal(sessionDecision(clock, makeFrame(), T + 2900, 2900).canShowSignal, true);
  const sample = clock.sample(T + 2950, 3100);
  assert.equal(sample.valid, true);
  assert.equal(sample.nowEpochMs, T + 3100);
  assert.equal(evaluateLiveFrame(makeFrame(), DEMO_TARGET, [DEMO_TARGET], sample.nowEpochMs).reason, 'stale');
});

test('delayed pre-invalidation response is rejected during and after fresh request recovery', () => {
  const clock = new ClockSession(T, 0);
  const oldRequest = clock.beginRequest(T + 1000, 1000);
  clock.sample(T + 900, 1100);
  const newRequest = clock.beginRequest(T + 1000, 1200);
  assert.equal(clock.phase, 'recovering');
  assert.equal(clock.sample(T + 1100, 1300).canDisplay, false);
  assert.equal(clock.acceptResponse(oldRequest, T + 1100, 1300), false);
  assert.equal(clock.acceptResponse(newRequest, T + 1200, 1400), true);
  assert.equal(clock.phase, 'ready');
  assert.equal(clock.acceptResponse(oldRequest, T + 1300, 1500), false);
});

test('a clock change while the new request is pending invalidates that request too', () => {
  const clock = new ClockSession(T, 0);
  const ticket = clock.beginRequest(T, 0);
  assert.equal(clock.acceptResponse(ticket, T - 1000, 500), false);
  assert.equal(clock.phase, 'invalid');
});

test('large forward wall/monotonic drift requires a new clock session', () => {
  const clock = new ClockSession(T, 0);
  assert.equal(clock.sample(T + 5000, 1000).valid, false);
  assert.equal(clock.sample(T + 5100, 1100).canDisplay, false);
});

test('simulation clock invalidation stays latched until an explicit reset', () => {
  const clock = new ClockSession(T, 0);
  clock.sample(T + 1000, 1000);
  clock.sample(T, 1100);
  for (const offset of [100, 200, 1000, 10000]) assert.equal(clock.sample(T + offset, offset + 1100).canDisplay, false);
  clock.resetExplicit(T + 11000, 12100);
  assert.equal(clock.sample(T + 11100, 12200).canDisplay, true);
});

test('source delay is subtracted from remaining time and expiry does not synthesize the next phase', () => {
  assert.equal(evaluateFrame(makeFrame(), DEMO_TARGET, T + 2000).remainingSeconds, 13);
  const shortFrame = makeFrame({ remainingDeciseconds: 10, expiresAtMs: T + 1000 });
  assert.equal(evaluateFrame(shortFrame, DEMO_TARGET, T + 900).remainingSeconds, 1);
  assert.equal(evaluateFrame(shortFrame, DEMO_TARGET, T + 1000).reason, 'expired');
  assertUnknown(evaluateFrame(shortFrame, DEMO_TARGET, T + 2000));
});

test('future source timestamps never authorize a phase', () => {
  const frame = makeFrame({ sourceTimestampMs: T + 1, expiresAtMs: T + 15001 });
  assert.equal(evaluateFrame(frame, DEMO_TARGET, T).reason, 'future-timestamp');
  assertUnknown(evaluateLiveFrame(frame, DEMO_TARGET, [DEMO_TARGET], T));
});

test('all rejected live contracts suppress both phase and countdown', () => {
  const cases = [
    [null, [DEMO_TARGET]],
    [makeFrame(), []],
    [makeFrame({ status: 'unknown', reason: 'mapping-unverified' }), [DEMO_TARGET]],
    [makeFrame({ schemaVersion: 2 }), [DEMO_TARGET]],
    [makeFrame({ source: 'simulation' }), [DEMO_TARGET]],
    [makeFrame({ sourceTimestampMs: null }), [DEMO_TARGET]],
    [makeFrame({ sourceTimestampMs: T - 4000 }), [DEMO_TARGET]],
    [makeFrame({ sourceTimestampMs: T + 1 }), [DEMO_TARGET]],
    [makeFrame({ target: { ...DEMO_TARGET, intersectionId: 'OTHER' } }), [DEMO_TARGET]],
    [makeFrame({ target: { ...DEMO_TARGET, approach: 'SE' } }), [DEMO_TARGET]],
    [makeFrame({ target: { ...DEMO_TARGET, movement: 'LEFT' } }), [DEMO_TARGET]],
    [makeFrame({ target: { ...DEMO_TARGET, mappingVersion: 'OTHER' } }), [DEMO_TARGET]],
    [makeFrame({ phase: 'YELLOW' }), [DEMO_TARGET]],
    [makeFrame({ phase: 'UNKNOWN' }), [DEMO_TARGET]],
    [makeFrame({ remainingDeciseconds: null }), [DEMO_TARGET]],
    [makeFrame({ remainingDeciseconds: 0 }), [DEMO_TARGET]],
    [makeFrame({ remainingDeciseconds: -1 }), [DEMO_TARGET]],
    [makeFrame({ remainingDeciseconds: 36001 }), [DEMO_TARGET]],
    [makeFrame({ remainingDeciseconds: 1.5 }), [DEMO_TARGET]],
    [makeFrame({ expiresAtMs: T + 999999 }), [DEMO_TARGET]],
  ];
  for (const [frame, approved] of cases) assertUnknown(evaluateLiveFrame(frame, DEMO_TARGET, approved, T));
});
