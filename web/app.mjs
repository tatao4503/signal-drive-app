import { ClockSession, DEMO_TARGET, evaluateFrame, evaluateLiveFrame, unknown, REASON_LABELS } from './trust.mjs';

const $ = id => document.getElementById(id);
const directions = { N: '북쪽', NE: '북동', E: '동쪽', SE: '남동', S: '남쪽', SW: '남서', W: '서쪽', NW: '북서' };
const movements = { STRAIGHT: '직진', LEFT: '좌회전', UTURN: '유턴', BUS: '버스', BICYCLE: '자전거', PEDESTRIAN: '보행' };
const scenarios = new Set(['normal', 'alternate', 'stale', 'future', 'mismatch', 'offline', 'expired', 'uncertain', 'recovered']);
const clock = new ClockSession(Date.now(), performance.now());
const state = { mode: 'demo', scenario: 'normal', vehicle: 'parked', labOpen: false, demoDeadline: Date.now() + 32000, demoFrame: null, lastDemoRefresh: 0, liveFrame: null, health: null, target: null, liveReason: 'no-data', activeRequest: null, pollTimer: null, replayTimers: [], lastAnnounced: '', disposed: false, requestGeneration: 0, handledInvalidGeneration: null };

function targetForMode() { return state.mode === 'demo' ? DEMO_TARGET : state.target; }
function sourceTime(ms) { return Number.isFinite(ms) ? new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ms)) : '—'; }
function reasonLabel(reason) { return REASON_LABELS[reason] || '데이터 상태 확인 필요'; }
function isRestricted() { return state.vehicle !== 'parked'; }

function createDemoFrame(nowMs) {
  const common = { target: { ...DEMO_TARGET }, source: 'simulation', sourceTimestampMs: nowMs, phase: state.scenario === 'alternate' ? 'GREEN' : 'RED', remainingDeciseconds: Math.floor((state.demoDeadline - nowMs) / 100) };
  switch (state.scenario) {
    case 'stale': return { ...common, sourceTimestampMs: nowMs - 8000, remainingDeciseconds: 240 };
    case 'future': return { ...common, sourceTimestampMs: nowMs + 10000, remainingDeciseconds: 240 };
    case 'mismatch': return { ...common, target: { ...common.target, intersectionId: 'DEMO-OTHER' } };
    case 'expired': return { ...common, sourceTimestampMs: nowMs - 2000, remainingDeciseconds: 10 };
    case 'uncertain': return { ...common, target: { ...common.target, approach: null } };
    case 'offline': return null;
    default: return common;
  }
}

function handleInvalidClock(sample) {
  if (!sample.valid && state.handledInvalidGeneration !== sample.generation) {
    state.handledInvalidGeneration = sample.generation;
    cancelLive(); stopReplay();
    state.liveFrame = null; state.demoFrame = null;
    state.liveReason = 'clock-invalid';
    // This can run at an async response boundary between render ticks.
    // Remove any previous visual/accessibility state immediately.
    $('signal-readout').hidden = true;
    $('unknown-readout').hidden = false;
    $('phase-label').textContent = ''; $('countdown').textContent = '';
    $('signal-readout').removeAttribute('aria-label');
    $('signal-card').classList.remove('phase-red', 'phase-green');
    $('signal-card').classList.add('is-unknown');
    $('unknown-reason').textContent = reasonLabel('clock-invalid');
    $('availability').textContent = '정보 표시 보류';
    $('announcer').textContent = `현재 신호 확인 불가. ${reasonLabel('clock-invalid')}`;
    if (state.mode === 'live' && !state.disposed && !document.hidden) state.pollTimer = setTimeout(() => pollLive(true), 2000);
  }
}

function readClock() {
  const sample = clock.sample(Date.now(), performance.now());
  handleInvalidClock(sample);
  return sample;
}

function currentDecision(nowMs, clockSample) {
  if (!clockSample.canDisplay) return unknown('clock-invalid');
  const frame = state.mode === 'live' ? state.liveFrame : state.demoFrame;
  // A monotonic age floor must not accidentally authorize future source data.
  if (frame && frame.sourceTimestampMs > clockSample.wallEpochMs) return unknown('future-timestamp');
  if (state.mode === 'live') return state.liveFrame ? evaluateLiveFrame(state.liveFrame, state.target, state.health?.targets, nowMs, state.health?.policy) : unknown(state.liveReason);
  if (state.scenario === 'offline') return unknown('upstream-unavailable');
  if (state.scenario === 'uncertain') return unknown('approach-unknown', { target: true });
  const result = evaluateFrame(state.demoFrame, DEMO_TARGET, nowMs);
  return result.reason === 'invalid-remaining' && state.demoDeadline <= nowMs ? unknown('expired') : result;
}

function renderChecks(decision) {
  const labels = [ ['target', '교차로 매핑', state.mode === 'demo' ? '시연 대상 일치' : '서버 등록 대상'], ['direction', '접근 방향 · 움직임', '북서 접근 · 직진'], ['freshness', '원천 데이터 유효성', '허용 시간 이내'], ['phase', '현시 · 만료 확인', '명시된 상태만 표시'] ];
  const target = targetForMode();
  const fragment = document.createDocumentFragment();
  for (const [key, title, value] of labels) {
    const row = document.createElement('div'); row.className = 'trust-check-row';
    const dt = document.createElement('dt'); dt.textContent = title;
    const dd = document.createElement('dd');
    const text = document.createElement('span');
    text.textContent = decision.checks[key] ? (key === 'direction' ? `${directions[target?.approach] || '미확정'} 접근 · ${movements[target?.movement] || '미확정'}` : value) : '확인 필요';
    const icon = document.createElement('span'); icon.className = `check-symbol${decision.checks[key] ? '' : ' wait'}`; icon.textContent = decision.checks[key] ? '✓' : '·'; icon.setAttribute('aria-hidden', 'true');
    dd.append(text, icon); row.append(dt, dd); fragment.append(row);
  }
  $('trust-checks').replaceChildren(fragment);
}

function render() {
  const clockSample = readClock();
  const now = clockSample.nowEpochMs ?? clockSample.wallEpochMs;
  const decision = currentDecision(now, clockSample);
  const target = targetForMode();
  const demo = state.mode === 'demo';
  $('demo-mode').setAttribute('aria-selected', String(demo));
  $('live-mode').setAttribute('aria-selected', String(!demo));
  $('mode-tag').textContent = demo ? 'DEMO' : 'SERVER';
  $('provenance-label').textContent = demo ? '시연 데이터 · 실제 신호 아님' : '서버 데이터 · 검증된 대상만 표시';
  $('provenance-detail').textContent = demo ? '한 교차로의 데이터 흐름을 확인합니다.' : 'API 키는 서버에서만 관리합니다.';
  $('target-label').textContent = target?.label || '등록된 교차로 없음';
  $('target-description').replaceChildren();
  if (target) {
    $('target-description').append(document.createTextNode(`${directions[target.approach] || '방향 미확정'} 접근 `));
    const arrow = document.createElement('span'); arrow.textContent = '→'; arrow.setAttribute('aria-hidden', 'true');
    $('target-description').append(arrow, document.createTextNode(` ${movements[target.movement] || '대상 미확정'}`));
  } else $('target-description').textContent = '검증된 매핑을 서버에 등록하면 연결할 수 있습니다.';

  $('signal-card').classList.toggle('is-unknown', !decision.canShowSignal);
  $('signal-readout').hidden = !decision.canShowSignal;
  $('unknown-readout').hidden = decision.canShowSignal;
  if (decision.canShowSignal) {
    $('signal-card').classList.toggle('phase-red', decision.phase === 'RED');
    $('signal-card').classList.toggle('phase-green', decision.phase === 'GREEN');
    $('phase-label').textContent = decision.phase === 'RED' ? '적색' : '녹색';
    $('countdown').textContent = String(decision.remainingSeconds);
    $('availability').textContent = demo ? '시연 입력 확인' : '서버 검증 조건 확인';
    $('signal-readout').setAttribute('aria-label', `${demo ? '시연 데이터, ' : ''}${$('phase-label').textContent}, 잔여 ${decision.remainingSeconds}초. 실제 현장 신호를 우선 확인하세요.`);
  } else {
    $('phase-label').textContent = '';
    $('countdown').textContent = '';
    $('signal-readout').removeAttribute('aria-label');
    $('signal-card').classList.remove('phase-red', 'phase-green');
    $('unknown-reason').textContent = reasonLabel(decision.reason);
    $('availability').textContent = '정보 표시 보류';
  }
  $('trust-intro').textContent = demo ? '시연 입력도 방향과 시간 조건을 확인합니다.' : '승인된 매핑과 유효한 데이터가 모두 필요합니다.';
  $('source-time').textContent = sourceTime(decision.sourceTimestampMs);
  $('age-label').textContent = decision.sourceTimestampMs ? (now >= decision.sourceTimestampMs ? `${((now - decision.sourceTimestampMs) / 1000).toFixed(1)}초 전 원천 입력` : '미래 시각 입력 · 사용 불가') : '유효한 원천 입력 없음';
  $('trust-note').textContent = demo ? '시연 입력은 실제 교차로와 연결되지 않습니다.' : '현재 신호와 다를 수 있습니다. 현장 신호를 우선 확인하세요.';
  renderChecks(decision);
  const restricted = isRestricted();
  $('vehicle-pill').classList.toggle('restricted', restricted);
  $('vehicle-label').textContent = state.vehicle === 'parked' ? '모의 차량 · 정차' : state.vehicle === 'driving' ? '모의 차량 · 주행' : '모의 차량 · 미확인';
  $('driving-notice').hidden = !restricted;
  $('scenario').disabled = restricted || !demo;
  $('replay').disabled = restricted || !demo;
  $('demo-mode').disabled = restricted;
  $('live-mode').disabled = restricted;
  $('lab-locked').hidden = !restricted;
  $('lab-body').hidden = !state.labOpen;
  $('lab-toggle').setAttribute('aria-expanded', String(state.labOpen));
  $('lab-toggle').replaceChildren(document.createTextNode(state.labOpen ? '접기 −' : '펼치기 +'));
  $('scenario-note').textContent = !demo ? '서버 데이터는 시연 제어로 변경할 수 없습니다.' : '실시간 데이터의 정확성을 평가하는 화면이 아닙니다.';
  const announcement = `${state.mode}:${decision.canShowSignal ? decision.phase : decision.reason}`;
  if (state.lastAnnounced !== announcement) {
    $('announcer').textContent = decision.canShowSignal ? `${demo ? '시연 데이터입니다. ' : ''}${$('phase-label').textContent} 상태 표시. 실제 현장 신호를 우선 확인하세요.` : `현재 신호 확인 불가. ${reasonLabel(decision.reason)}`;
    state.lastAnnounced = announcement;
  }
}

function stopReplay() { state.replayTimers.forEach(clearTimeout); state.replayTimers = []; $('replay').textContent = '장애 흐름 재생 ↗'; }
function setScenario(name, fromReplay = false) {
  if (isRestricted() || state.mode !== 'demo' || !scenarios.has(name)) return;
  // An automatic replay callback is never a clock recovery action.
  if (fromReplay && !readClock().canDisplay) return;
  if (!fromReplay) stopReplay();
  if (!fromReplay) clock.resetExplicit(Date.now(), performance.now());
  state.scenario = name; state.demoDeadline = Date.now() + 32000; state.lastDemoRefresh = 0;
  state.demoFrame = createDemoFrame(Date.now()); $('scenario').value = name; render();
}

function cancelLive() {
  state.requestGeneration += 1;
  clearTimeout(state.pollTimer); state.pollTimer = null;
  state.activeRequest?.abort(); state.activeRequest = null;
}

async function getJson(path, signal) {
  const response = await fetch(path, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data?.reason === 'string' ? data.reason : 'upstream-unavailable');
  return data;
}

async function pollLive(refreshHealth = false) {
  if (state.mode !== 'live' || state.disposed || document.hidden || state.activeRequest) return;
  readClock();
  clearTimeout(state.pollTimer); state.pollTimer = null;
  const clockTicket = clock.beginRequest(Date.now(), performance.now());
  const generation = state.requestGeneration;
  const controller = new AbortController(); state.activeRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    if (refreshHealth || !state.health) {
      const health = await getJson('/api/health', controller.signal);
      readClock();
      if (generation !== state.requestGeneration) return;
      state.health = health?.schemaVersion === 1 && health.ok === true ? health : null;
      state.target = Array.isArray(state.health?.targets) ? state.health.targets[0] || null : null;
    }
    if (!state.target || !state.health?.keyConfigured) {
      const accepted = clock.acceptResponse(clockTicket, Date.now(), performance.now()); readClock();
      if (!accepted || generation !== state.requestGeneration) return;
      state.liveFrame = null; state.liveReason = !state.target ? 'target-not-configured' : 'api-key-missing'; return;
    }
    const frame = await getJson(`/api/signal?target=${encodeURIComponent(state.target.id)}`, controller.signal);
    const accepted = clock.acceptResponse(clockTicket, Date.now(), performance.now()); readClock();
    if (!accepted || generation !== state.requestGeneration) return;
    state.liveFrame = frame; state.liveReason = frame.reason || 'no-data';
  } catch (error) {
    if (generation !== state.requestGeneration) return;
    state.liveFrame = null; state.liveReason = error.name === 'AbortError' ? 'upstream-timeout' : REASON_LABELS[error.message] ? error.message : 'upstream-unavailable';
  } finally {
    clearTimeout(timeout);
    if (state.activeRequest === controller) state.activeRequest = null;
    if (generation === state.requestGeneration && state.mode === 'live' && !state.disposed) {
      render(); state.pollTimer = setTimeout(() => pollLive(!state.target || !state.health?.keyConfigured), state.target && state.health?.keyConfigured ? 2000 : 6000);
    }
  }
}

function setMode(mode) {
  if (isRestricted() || !['demo', 'live'].includes(mode)) return;
  cancelLive(); stopReplay(); state.mode = mode;
  state.liveFrame = null; state.liveReason = 'no-data'; state.health = null; state.target = null;
  if (mode === 'demo') setScenario('normal'); else { render(); void pollLive(true); }
}

$('scenario').addEventListener('change', event => setScenario(event.target.value));
$('vehicle-state').addEventListener('change', event => {
  state.vehicle = ['parked', 'driving', 'unknown'].includes(event.target.value) ? event.target.value : 'unknown';
  if (isRestricted()) stopReplay(); render();
});
$('lab-toggle').addEventListener('click', () => { state.labOpen = !state.labOpen; render(); });
$('demo-mode').addEventListener('click', () => setMode('demo'));
$('live-mode').addEventListener('click', () => setMode('live'));
$('replay').addEventListener('click', () => {
  if (isRestricted() || state.mode !== 'demo') return;
  stopReplay(); setScenario('normal', true);
  const steps = [[4500, 'stale'], [8000, 'mismatch'], [11500, 'offline'], [15000, 'recovered']];
  $('replay').textContent = '장애 흐름 재생 중…';
  state.replayTimers = steps.map(([delay, scenario]) => setTimeout(() => { setScenario(scenario, true); if (scenario === 'recovered') stopReplay(); }, delay));
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelLive(); stopReplay(); state.liveFrame = null; state.liveReason = 'background-resume'; }
  else {
    const sample = readClock();
    if (state.mode === 'live') { render(); void pollLive(true); } else { if (sample.canDisplay) state.demoFrame = createDemoFrame(Date.now()); render(); }
  }
});
window.addEventListener('pagehide', () => { state.disposed = true; cancelLive(); stopReplay(); });
window.addEventListener('pageshow', event => { if (event.persisted) { state.disposed = false; state.liveFrame = null; state.liveReason = 'background-resume'; render(); if (state.mode === 'live') void pollLive(true); } });
state.demoFrame = createDemoFrame(Date.now());
render();
setInterval(() => {
  if (document.hidden || state.disposed) return;
  const sample = readClock();
  const wall = Date.now();
  if (sample.canDisplay && state.mode === 'demo' && wall - state.lastDemoRefresh >= 1000 && state.demoDeadline > wall) { state.demoFrame = createDemoFrame(wall); state.lastDemoRefresh = wall; }
  render();
}, 200);
