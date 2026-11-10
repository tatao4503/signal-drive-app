// Device integration checker. App-owned trace assertions and screenshots are separate evidence.
// No independent pixel/accessibility-tree review is claimed by this script.
// Usage: node scripts/android-device-check.mjs APK NEW_RESULT_DIR [--serial ID] [--clock]
// --clock and AAOS HAL changes require an explicitly selected dedicated qemu emulator.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File, collectSourceIdentity, newestBuildTools, parseCertificate } from './build-release.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PKG = 'kr.signal.drive';
export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
export function selectDevice(output, requestedSerial = null) {
  const rows = output.split(/\r?\n/).map(line => line.trim().match(/^(\S+)\s+(device|offline|unauthorized)\b/)).filter(Boolean).map(m => ({ serial: m[1], status: m[2] }));
  if (requestedSerial) {
    const row = rows.find(item => item.serial === requestedSerial);
    if (!row || row.status !== 'device') throw new Error('지정한 기기가 연결·승인된 상태가 아닙니다. 기기를 변경하지 않았습니다.');
    return row.serial;
  }
  const ready = rows.filter(row => row.status === 'device');
  if (ready.length !== 1) throw new Error('연결된 기기를 하나로 특정할 수 없습니다. --serial을 지정하세요. 기기를 변경하지 않았습니다.');
  return ready[0].serial;
}
export function parseWmOverride(output) {
  const match = output.match(/^Override size:\s*(\d+)x(\d+)\s*$/m);
  if (!match) return null;
  if (+match[1] < 1 || +match[2] < 1 || +match[1] > 20000 || +match[2] > 20000) throw new Error('화면 크기 원본을 확인할 수 없습니다.');
  return `${match[1]}x${match[2]}`;
}
export function parseInt32Property(output) {
  if (!/\bstatus:\s*0\s*,/.test(output)) throw new Error('원본 차량 속성이 정상 상태가 아닙니다.');
  const match = output.match(/\bint32Values:\s*\[\s*(-?\d+)\s*\]/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error('원본 차량 속성을 하나로 읽을 수 없습니다.');
  return Number(match[1]);
}
export function validateSnapshot(snapshot) {
  if (!['0', '1', 'null'].includes(snapshot.rotationAuto) || !['0', '1', '2', '3', 'null'].includes(snapshot.rotationUser) || !['0', '1', 'null'].includes(snapshot.autoTime)) throw new Error('기기의 원래 설정을 확인할 수 없습니다. 변경하지 않았습니다.');
  if (snapshot.wmSizeOverride !== null && !/^\d{1,5}x\d{1,5}$/.test(snapshot.wmSizeOverride)) throw new Error('원래 화면 크기가 유효하지 않습니다.');
  if (typeof snapshot.debugLogProperty !== 'string' || snapshot.debugLogProperty.length > 128) throw new Error('원래 로그 설정이 유효하지 않습니다.');
  if (!Number.isSafeInteger(snapshot.epochSeconds) || snapshot.epochSeconds <= 0 || !Number.isFinite(snapshot.elapsedMs)) throw new Error('기기의 원래 시각을 확인할 수 없습니다.');
  if (snapshot.fontScale !== undefined && snapshot.fontScale !== 'null' && (!/^\d+(?:\.\d+)?$/.test(snapshot.fontScale) || !Number.isFinite(Number(snapshot.fontScale)) || Number(snapshot.fontScale) <= 0 || Number(snapshot.fontScale) > 10)) throw new Error('원래 글자 크기를 확인할 수 없습니다.');
  if (snapshot.vhal && (!Number.isSafeInteger(snapshot.vhal.gear) || ![0, 1].includes(snapshot.vhal.parkingBrake))) throw new Error('원래 차량 상태를 확인할 수 없습니다.');
  return snapshot;
}
export function buildRestoreCommands(snapshot, { restoreClock = false, restoreVehicle = false, elapsedNowMs = performance.now() } = {}) {
  validateSnapshot(snapshot);
  const commands = [];
  const setting = (scope, key, value) => value === 'null' ? `settings delete ${scope} ${key}` : `settings put ${scope} ${key} ${value}`;
  if (restoreVehicle && snapshot.vhal) {
    commands.push({ label: 'vehicle-gear', command: `cmd car_service inject-vhal-event 0x11400400 0 ${snapshot.vhal.gear}` });
    commands.push({ label: 'vehicle-parking-brake', command: `cmd car_service inject-vhal-event 0x11200402 0 ${snapshot.vhal.parkingBrake === 1 ? 'true' : 'false'}` });
  }
  if (restoreClock) {
    const elapsedSeconds = Math.max(0, Math.floor((elapsedNowMs - snapshot.elapsedMs) / 1000));
    commands.push({ label: 'device-clock', command: `date @${snapshot.epochSeconds + elapsedSeconds}` });
  }
  commands.push({ label: 'auto-time', command: setting('global', 'auto_time', snapshot.autoTime) });
  commands.push({ label: 'rotation-auto', command: setting('system', 'accelerometer_rotation', snapshot.rotationAuto) });
  commands.push({ label: 'rotation-user', command: setting('system', 'user_rotation', snapshot.rotationUser) });
  if (snapshot.fontScale !== undefined) commands.push({ label: 'font-scale', command: setting('system', 'font_scale', snapshot.fontScale) });
  commands.push({ label: 'screen-override', command: snapshot.wmSizeOverride ? `wm size ${snapshot.wmSizeOverride}` : 'wm size reset' });
  commands.push({ label: 'trace-property', command: `setprop log.tag.SignalDriveUi ${shellQuote(snapshot.debugLogProperty)}` });
  return commands;
}
export function executeRestoration(commands, execute) {
  const steps = commands.map(({ label, command }) => {
    try { execute(command); return { label, ok: true }; }
    catch { return { label, ok: false, error: '복구 명령 실패. 기기 상태를 직접 확인하세요.' }; }
  });
  return { ok: steps.every(step => step.ok), steps };
}
export function shown(s) {
  return s.sourceOnScreen === true && s.phaseOnScreen === true && s.secondsOnScreen === true && /^(녹색|적색|황색) 신호$/.test(s.phase) && /^\d+초$/.test(s.seconds) && /잔여시간 \d+초/.test(s.secondsDesc);
}
export function hidden(s) {
  return s.phaseOnScreen === true && s.phase.replace(/\s+/g, ' ') === '현재 신호 확인 불가' && !s.seconds && !s.secondsDesc && s.secondsOnScreen === false;
}
export function parseCheckArgs(argv) {
  const [apk, outDir, ...rest] = argv;
  if (!apk || !outDir || apk.startsWith('--') || outDir.startsWith('--')) throw new Error('APK와 새 결과 폴더가 필요합니다.');
  let serial = null, withClock = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--clock' && !withClock) withClock = true;
    else if (rest[i] === '--serial' && !serial && rest[i + 1] && !rest[i + 1].startsWith('--')) serial = rest[++i];
    else throw new Error('검증 옵션을 확인하세요.');
  }
  if (withClock && (!serial || !/^emulator-\d+$/.test(serial))) throw new Error('--clock은 --serial로 명시한 전용 에뮬레이터에서만 실행합니다.');
  return { apk: path.resolve(apk), outDir: path.resolve(outDir), serial, withClock };
}
export async function runDeviceCheck(argv = process.argv.slice(2)) {
  const options = parseCheckArgs(argv);
  const { apk, outDir, withClock } = options;
  if (!existsSync(apk) || !path.basename(apk).endsWith('.apk')) throw new Error('설치할 APK 파일을 찾을 수 없습니다.');
  if (existsSync(outDir) && readdirSync(outDir).length) throw new Error('이전 검증 결과를 덮어쓰지 않습니다. 새 결과 폴더를 지정하세요.');
  const toolchain = path.resolve(PROJECT_ROOT, '../toolchains/paths.json');
  const tools = existsSync(toolchain) ? JSON.parse(readFileSync(toolchain, 'utf8')) : {};
  const sdk = process.env.ANDROID_HOME || tools.sdk;
  const adbPath = path.join(sdk || '', 'platform-tools', 'adb');
  if (!existsSync(adbPath)) throw new Error('adb가 없습니다. platform-tools를 설치하세요.');
  const devices = spawnSync(adbPath, ['devices'], { encoding: 'utf8', timeout: 15000 });
  if (devices.status !== 0) throw new Error('기기 목록을 읽을 수 없습니다.');
  const serial = selectDevice(devices.stdout, options.serial);
  let interrupted = false, appStarted = false, clockTouched = false, vehicleTouched = false, minimumTraceMs = 0;
  let snapshot = null;
  const results = [], screenshots = [];
  const metadata = { schemaVersion: 2, startedAt: new Date().toISOString(), apk: { name: path.basename(apk), sha256: sha256File(apk) }, source: collectSourceIdentity(PROJECT_ROOT), device: { serial }, evidenceMethod: 'app-owned-view-trace-and-adb-actions', independentVisualReview: 'not-performed-by-script' };
  function adb(cmdArgs, opts = {}) {
    if (interrupted && !opts.cleanup) throw new Error('검증을 중단했습니다.');
    const r = spawnSync(adbPath, ['-s', serial, ...cmdArgs], { encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
    if ((!(opts.successCodes || [0]).includes(r.status) || r.error) && !opts.allowFail) throw new Error(`adb 명령 실패: ${cmdArgs[0]}`);
    return opts.binary ? r.stdout : String(r.stdout || '').trim();
  }
  const shell = (command, opts) => adb(['shell', command], opts);
  const sleep = async ms => { await new Promise(resolve => setTimeout(resolve, ms)); if (interrupted) throw new Error('검증을 중단했습니다.'); };
  const deviceElapsed = () => {
    const elapsed = Number(shell('cat /proc/uptime').split(/\s/)[0]);
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('기기 monotonic 시각을 읽을 수 없습니다.');
    return Math.floor(elapsed * 1000);
  };
  const markAction = () => { minimumTraceMs = deviceElapsed(); };
  const onInterrupt = () => { interrupted = true; };
  process.once('SIGINT', onInterrupt); process.once('SIGTERM', onInterrupt);
  function check(name, ok, detail) {
    results.push({ name, ok: Boolean(ok), detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
  function requireEmulator() {
    if (!options.serial || !/^emulator-\d+$/.test(serial) || shell('getprop ro.kernel.qemu') !== '1') throw new Error('시각·차량 HAL 변경은 명시 선택한 전용 qemu 에뮬레이터에서만 실행합니다.');
  }
  async function acquireRoot() {
    requireEmulator();
    adb(['root']); await sleep(2000); adb(['wait-for-device']);
    if (shell('id -u') !== '0') throw new Error('전용 에뮬레이터에서 root를 사용할 수 없습니다. 상태 변경을 시작하지 않았습니다.');
  }
// ── 화면 읽기 ──
// 남은 초가 1초마다 바뀌는 동안 UI Automator는 화면을 읽지 못한다(1초 무변화를 기다린다).
// 그래서 앱의 검증용 화면 기록(log.tag.SignalDriveUi=DEBUG일 때만 남음)을 읽는다.
// 기록에는 화면에 실제로 보이는 문구, 초 숫자(보일 때만), 접근성 설명, 버튼 위치·활성 상태가 들어 있다.
function trace() {
  const pids = shell(`pidof ${PKG}`, { allowFail: true }).split(/\s+/).filter(value => /^\d+$/.test(value)).map(Number);
  if (!pids.length) return null;
  const lines = shell('logcat -d -s SignalDriveUi:I -v raw', { allowFail: true }).split('\n').map(line => line.trim()).filter(line => line.startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const value = JSON.parse(lines[i]);
      if (pids.includes(value.processId) && Number.isFinite(value.traceElapsedMs) && value.traceElapsedMs >= minimumTraceMs) {
        if (value.windowFocused !== true) throw new Error('앱 창이 다른 시스템 창에 가려져 검증을 중단했습니다.');
        return value;
      }
    } catch (error) { if (error.message?.includes('시스템 창')) throw error; }
  }
  return null;
}
function size() {
  // 회전·wm size를 반영한 현재 표시 크기. (물리 크기는 회전해도 그대로라 쓰면 안 된다)
  const m = shell('dumpsys window displays', { allowFail: true }).match(/cur=(\d+)x(\d+)/);
  return m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 2400 };
}
async function scroll(dir) {
  const { w, h } = size();
  const [y1, y2] = dir === 'down' ? [Math.round(h * 0.8), Math.round(h * 0.2)] : [Math.round(h * 0.2), Math.round(h * 0.8)];
  markAction(); shell(`input swipe ${Math.round(w / 2)} ${y1} ${Math.round(w / 2)} ${y2} 250`);
  await sleep(600);
}
async function toTop() { for (let i = 0; i < 4; i++) await scroll('up'); }
async function find(text) {
  const now = trace()?.buttons.find((b) => b.text === text && b.onScreen);
  if (now) return now;
  await toTop();
  for (let i = 0; i < 15; i++) {
    const t = trace();
    const hit = t?.buttons.find((b) => b.text === text && b.onScreen);
    if (hit) return hit;
    await scroll('down');
  }
  return null;
}
async function reachFooter() {
  await toTop();
  for (let i = 0; i < 15; i++) {
    if (trace()?.footerOnScreen) return true;
    await scroll('down');
  }
  return false;
}
async function tap(text) {
  const n = await find(text);
  if (!n) throw new Error(`화면에서 "${text}"를 찾지 못했습니다`);
  markAction(); shell(`input tap ${n.x} ${n.y}`);
  await sleep(900);
  return n;
}
async function state() {
  await sleep(300);
  let t = trace();
  if (t && (!t.phaseOnScreen || !t.sourceOnScreen)) { await toTop(); await sleep(300); t = trace(); }
  return { ...t, source: t?.source || '', phase: t?.phase || '', seconds: t?.seconds || '', secondsDesc: t?.secondsDesc || '', reason: t?.reason || '', ux: t?.ux || '', sourceOnScreen: t?.sourceOnScreen === true, phaseOnScreen: t?.phaseOnScreen === true, secondsOnScreen: t?.secondsOnScreen === true };
}
async function shot(name) {
  const png = adb(['exec-out', 'screencap', '-p'], { binary: true });
  const filename = `${name}.png`;
  writeFileSync(path.join(outDir, filename), png, { flag: 'wx' });
  const t = trace();
  screenshots.push({ filename, sha256: createHash('sha256').update(png).digest('hex'), at: new Date().toISOString(), traceProcessId: t?.processId ?? null, traceElapsedMs: t?.traceElapsedMs ?? null, independentVisualReview: 'not-performed-by-script' });
}

async function main() {
  const model = shell('getprop ro.product.model');
  const release = shell('getprop ro.build.version.release');
  const sdkInt = shell('getprop ro.build.version.sdk');
  const automotiveFlag = shell('pm has-feature android.hardware.type.automotive', { successCodes: [0, 1] });
  if (!['true', 'false'].includes(automotiveFlag)) throw new Error('차량 기기 종류를 확인할 수 없습니다.');
  const automotive = automotiveFlag === 'true';
  const qemu = shell('getprop ro.kernel.qemu') === '1';
  metadata.device = { serial, model, release, sdkInt: Number(sdkInt), automotive, qemu, avdName: qemu ? shell('getprop ro.boot.qemu.avd_name') : null };
  if (withClock || automotive) requireEmulator();
  snapshot = validateSnapshot({
    rotationAuto: shell('settings get system accelerometer_rotation'),
    rotationUser: shell('settings get system user_rotation'),
    autoTime: shell('settings get global auto_time'),
    fontScale: shell('settings get system font_scale'),
    wmSizeOverride: parseWmOverride(shell('wm size')),
    debugLogProperty: shell('getprop log.tag.SignalDriveUi'),
    epochSeconds: Number(shell('date +%s')), elapsedMs: performance.now(),
  });
  if (automotive) {
    const gear = parseInt32Property(shell('cmd car_service get-property-value 0x11400400 0'));
    const parkingBrake = parseInt32Property(shell('cmd car_service get-property-value 0x11200402 0'));
    if (![0, 1].includes(parkingBrake)) throw new Error('원래 주차 브레이크 상태를 확인할 수 없습니다.');
    snapshot.vhal = { gear, parkingBrake };
  }
  const signer = path.join(newestBuildTools(sdk), 'apksigner');
  const certificateResult = spawnSync(signer, ['verify', '--print-certs', '--min-sdk-version', '28', apk], { encoding: 'utf8', timeout: 30000, env: { ...process.env, JAVA_HOME: process.env.JAVA_HOME || tools.jdk } });
  if (certificateResult.status !== 0) throw new Error('설치 전 APK 서명을 확인할 수 없습니다. 기기를 변경하지 않았습니다.');
  const certificate = parseCertificate(certificateResult.stdout || '');
  if (!certificate.sha256) throw new Error('APK 인증서 해시를 읽을 수 없습니다.');
  metadata.apk.certificateSha256 = certificate.sha256;
  metadata.apk.isDebugCertificate = certificate.isDebugCertificate;
  mkdirSync(outDir, { recursive: true });
  console.log(`기기: ${model} · Android ${release} (API ${sdkInt}) · automotive=${automotive}`);
  console.log(`APK SHA-256: ${metadata.apk.sha256}`);
  deviceMutated = true;
  adb(['install', '-r', '-g', apk]);
  const dump = shell(`dumpsys package ${PKG}`);
  metadata.installed = { packageName: PKG, versionName: dump.match(/\bversionName=([^\s]+)/)?.[1] || null, versionCode: Number(dump.match(/\bversionCode=(\d+)/)?.[1]) || null };
  const packagePaths = shell(`pm path ${PKG}`).split('\n').map(line => line.match(/^package:(.+)$/)?.[1]).filter(Boolean);
  if (packagePaths.length !== 1) throw new Error('설치한 단일 APK의 경로를 특정할 수 없습니다.');
  const installedHash = shell(`sha256sum ${shellQuote(packagePaths[0])}`).match(/^([0-9a-f]{64})\s/i)?.[1]?.toLowerCase();
  metadata.installed.apkSha256 = installedHash || null;
  if (installedHash !== metadata.apk.sha256) throw new Error('입력 APK와 설치 APK 해시가 일치하지 않습니다.');
  if (!metadata.installed.versionName || !metadata.installed.versionCode) throw new Error('설치 버전을 확인할 수 없습니다.');
  check('입력·설치 APK 해시 일치', true, metadata.apk.sha256);
  await sleep(3000);
  shell('setprop log.tag.SignalDriveUi DEBUG');
  shell('logcat -c');
  shell(`am force-stop ${PKG}`);
  markAction();
  const launched = shell(`am start -W -n ${PKG}/.MainActivity`);
  if (/Error:|Exception/i.test(launched)) throw new Error('앱 시작에 실패했습니다.');
  await sleep(2500);
  let initial = trace();
  for (let i = 0; !initial && i < 15; i++) { await sleep(300); initial = trace(); }
  if (!initial) throw new Error('시작한 앱 프로세스의 새 UI 기록을 확인할 수 없습니다.');
  appStarted = true;
  metadata.appProcessId = initial.processId;

  if (automotive) {
    // AAOS: 실제 차량 제한 상태가 확인되기 전까지 실시간 화면·잠금으로 시작해야 한다.
    let s = await state();
    await shot('aaos-start');
    check('AAOS 시작 — 시연 데이터가 아니라 실시간 화면', s.sourceOnScreen && s.source.includes('실시간'), s.source);
    check('AAOS 시작 — 승인 매핑 없음 → 신호 표시 안 함', hidden(s), `${s.phase} / ${s.reason}`);

    // 주행 시험: 차량 HAL에 기어 D·주차 브레이크 해제를 넣는다(root 필요). 에뮬레이터 결과이며 실차가 아니다.
    await acquireRoot();
    const vhal = (prop, v) => { vehicleTouched = true; markAction(); return shell(`cmd car_service inject-vhal-event ${prop} 0 ${v}`); };
    const park = async () => { vhal('0x11200402', 'true'); vhal('0x11400400', '4'); await sleep(2500); };
    const drive = async () => { vhal('0x11400400', '8'); vhal('0x11200402', 'false'); await sleep(2500); };
    const top = () => shell('dumpsys activity activities | grep -m1 topResumedActivity', { allowFail: true });
    await park();
    await tap('시연 화면'); s = await state(); await shot('aaos-parked-demo');
    check('AAOS 정차 — 시연 화면 표시', s.sourceOnScreen && s.source === '시연 데이터 · 실제 신호 아님' && shown(s), `${s.phase} ${s.seconds}`);
    await drive(); s = await state(); await shot('aaos-driving');
    check('AAOS 공회전 제한 — 플랫폼이 앱을 막지 않음(DO 선언·승인 아님)', top().includes(PKG), top());
    check('AAOS 공회전 제한 — 주행 화면으로 전환', trace()?.driving === true);
    check('AAOS 공회전 제한 — 시연 데이터 자동 해제(가짜 신호 안 보임)', s.sourceOnScreen && s.source.includes('실시간') && hidden(s), `${s.source} | ${s.phase}`);
    check('AAOS 공회전 제한 — 시연 콘솔·화면 전환 숨김', Array.isArray(trace()?.buttons) && !trace().buttons.some((b) => b.text === '데이터 지연' || b.text === '시연 화면'));
    check('AAOS 공회전 제한 — 잠금 문구', s.ux.includes('설정 잠금'), s.ux);
    check('AAOS 공회전 제한 — 현장 신호 우선 안내 완전 표시', s.drivingNoticeOnScreen === true && s.drivingNotice.includes('현장 신호 우선 확인'), s.drivingNotice);
    await park(); s = await state(); await shot('aaos-parked-again');
    check('AAOS 정차 복귀 — 일반 화면 복귀, 시연으로 자동 복귀 안 함', trace()?.driving === false && s.sourceOnScreen && s.source.includes('실시간'), s.source);
    return;
  }

  // 1) 정상 시연
  let s = await state(); await shot('01-start');
  check('시작 화면 시연 표시', s.sourceOnScreen && s.source === '시연 데이터 · 실제 신호 아님', s.source);
  check('정상 녹색 — 색·초·접근성 표시', shown(s) && s.phase.includes('녹색'), `${s.phase} ${s.seconds} [${s.secondsDesc}]`);

  // 2) 보류 시나리오
  const holds = ['데이터 지연', '연결 단절', '교차로 불일치', '방향 미확정', '미래 시각', '잔여시간 만료'];
  for (const [i, name] of holds.entries()) {
    await tap(name); s = await state(); await shot(`02-${i + 1}-${name.replace(/ /g, '')}`);
    check(`${name} — 색·초·접근성 문구 제거`, hidden(s) && expectedHoldReason(name, s.reason), `${s.phase} | 초="${s.seconds}" | 설명="${s.secondsDesc}" | ${s.reason}`);
    check(`${name} — 시연 표시 유지`, s.sourceOnScreen && s.source === '시연 데이터 · 실제 신호 아님');
  }

  // 3) 복구
  await tap('복구'); s = await state(); await shot('03-recovery');
  check('복구 — 새 데이터로 표시 재개', shown(s), `${s.phase} ${s.seconds}`);
  await tap('정상 적색'); s = await state();
  check('정상 적색 — 적색 표시', shown(s) && s.phase.includes('적색'), s.phase);

  // 4) 모의 차량 잠금
  for (const label of ['주행', '미확인']) {
    await tap('정차'); await tap('정상 녹색'); await tap(label);
    // 주행 화면에서는 콘솔이 숨겨진다. 찾느라 스크롤하면 시연 창(24초)이 지나므로 지금 화면 기록만 본다.
    const btn = trace()?.buttons.find((b) => b.text === '데이터 지연');
    if (btn?.onScreen) { shell(`input tap ${btn.x} ${btn.y}`); await sleep(900); }
    s = await state(); await shot(`04-lock-${label}`);
    check(`모의 ${label} — 시연 버튼 숨김 또는 비활성`, !btn || btn.enabled === false, btn ? `enabled=${btn.enabled}` : '숨김');
    if (label === '주행') check('모의 주행 — 주행 화면(콘솔·교차로 정보 숨김)', trace()?.driving === true && Array.isArray(trace()?.buttons) && !trace().buttons.some((b) => b.text === '데이터 지연'));
    if (label === '주행') check('모의 주행 — 현장 신호 우선 안내 완전 표시', s.drivingNoticeOnScreen === true && s.drivingNotice.includes('현장 신호 우선 확인'), s.drivingNotice);
    check(`모의 ${label} — 눌러도 시나리오 안 바뀜(녹색 유지)`, shown(s) && s.phase.includes('녹색'), s.phase);
    check(`모의 ${label} — 잠금 문구`, s.ux.includes('설정 잠금'), s.ux);
  }
  await tap('정차');
  const unlocked = await find('데이터 지연');
  check('모의 정차 — 시연 버튼 다시 활성', unlocked?.enabled === true);

  // 5) 백그라운드 → 복귀
  await tap('정상 녹색');
  const beforeBackground = await state();
  markAction(); shell('input keyevent KEYCODE_HOME'); await sleep(3000);
  markAction(); shell(`am start -W -n ${PKG}/.MainActivity`); await sleep(2000);
  s = await state(); await shot('05-resume');
  const secs = parseInt(s.seconds, 10);
  check('백그라운드 복귀 — 새 원천 시각과 세션으로 표시', shown(s) && Number.isSafeInteger(s.sourceTimestampMs) && s.sourceTimestampMs > beforeBackground.sourceTimestampMs && s.traceSession !== beforeBackground.traceSession, `${s.phase} ${s.seconds}`);
  check('백그라운드 복귀 — 잔여시간이 시연 창(24초) 안', secs > 0 && secs <= 24, s.seconds);

  // 6) 화면 크기 변경 + 스크롤
  shell('settings put system accelerometer_rotation 0'); shell('settings put system user_rotation 1'); await sleep(2000);
  s = await state(); await shot('06-landscape-top');
  check('가로 전환 — 앱 유지·시연 표시', s.sourceOnScreen && s.source === '시연 데이터 · 실제 신호 아님');
  const footer = await reachFooter();
  await shot('06-landscape-bottom');
  check('가로 전환 — 맨 아래 안내까지 스크롤로 도달', Boolean(footer), `안내문 ${trace()?.footerBox}`);
  shell('settings put system user_rotation 0'); shell('wm size 1280x720'); await sleep(2000);
  const footerSmall = await reachFooter();
  await shot('06-small-bottom');
  check('작은 가로 화면(1280x720) — 맨 아래까지 스크롤', Boolean(footerSmall), `${size().w}x${size().h} · 안내문 ${trace()?.footerBox}`);
  // Large text on the short landscape viewport must keep the driving notice in view.
  markAction(); shell('settings put system font_scale 1.3'); await sleep(2500);
  await tap('정상 녹색'); await tap('주행');
  s = await state(); await shot('06-small-landscape-driving-large-text');
  check('작은 가로 시험 뷰포트 확인', size().w === 1280 && size().h === 720, `${size().w}x${size().h}`);
  check('작은 가로 화면·큰 글자 — 주행 출처·색·초 완전 표시', shown(s), `${size().w}x${size().h} · ${s.phase} ${s.seconds}`);
  check('작은 가로 화면·큰 글자 — 현장 신호 우선 안내 완전 표시', s.drivingNoticeOnScreen === true && s.drivingNotice.includes('현장 신호 우선 확인'), s.drivingNotice);
  await tap('정차');
  shell(snapshot.fontScale === 'null' ? 'settings delete system font_scale' : `settings put system font_scale ${snapshot.fontScale}`);
  shell(snapshot.wmSizeOverride ? `wm size ${snapshot.wmSizeOverride}` : 'wm size reset');
  shell('settings put system user_rotation 0'); await sleep(2000);

  // 7) 시계 이상
  if (withClock) {
    await acquireRoot();
    clockTouched = true; shell('settings put global auto_time 0');
    shell(`am start -W -n ${PKG}/.MainActivity`, { allowFail: true }); await sleep(1500);
    await tap('정상 녹색');
    const before = await state();
    check('시계 시험 전 — 표시 중', shown(before), before.seconds);
    const now = parseInt(shell('date +%s'), 10);
    markAction(); shell(`date @${now - 3600}`); await sleep(1500);
    s = await state(); await shot('07-clock-back');
    check('시계 1시간 뒤로 — 즉시 보류', hidden(s), `${s.phase} | ${s.reason}`);
    const now2 = parseInt(shell('date +%s'), 10);
    markAction(); shell(`date @${now2 + 3600}`); await sleep(2500);
    s = await state(); await shot('07-clock-restored');
    check('시계 복원 후 — 과거 패킷 자동 재표시 안 함', hidden(s), `${s.phase} | ${s.reason}`);
    await tap('정상 녹색'); s = await state();
    check('새 시연 입력 후 — 표시 재개', shown(s), s.seconds);
    check('전용 에뮬레이터에서 시계 시험 완료', true);
  }
}

  let deviceMutated = false;
  function expectedHoldReason(name, value) {
    const patterns = { '데이터 지연': /허용 갱신|지연/, '연결 단절': /현재 신호 데이터를 확인/, '교차로 불일치': /교차로.*다릅니다/, '방향 미확정': /진입 방향.*확인/, '미래 시각': /미래/, '잔여시간 만료': /유효시간.*끝/ };
    return patterns[name]?.test(value) === true;
  }
  try { await main(); }
  catch (error) { check('검증 실행', false, error.message); }
  finally {
    // Restore before collecting or writing evidence: a full disk or a failed log query must
    // never skip restoring a changed clock, vehicle state, rotation, size or font scale.
    metadata.appStarted = appStarted;
    metadata.restoration = deviceMutated && snapshot ? executeRestoration(buildRestoreCommands(snapshot, { restoreClock: clockTouched, restoreVehicle: vehicleTouched }), command => shell(command, { cleanup: true })) : { ok: true, steps: [], reason: 'device-not-modified' };
    if (!metadata.restoration.ok) check('기기 원래 설정 복구', false, '복구 실패 항목을 results.json에서 확인하세요.');
    if (appStarted) {
      try {
        // A failed query is unavailable evidence, not an empty and therefore clean crash log.
        const crashes = shell('logcat -d -b crash', { cleanup: true });
        const appCrash = crashes.split('\n').filter(line => line.includes(PKG));
        writeFileSync(path.join(outDir, 'logcat-crash.txt'), crashes || '(없음)', { flag: 'wx' });
        writeFileSync(path.join(outDir, 'logcat-app.txt'), shell(`logcat -d --pid=${metadata.appProcessId}`, { cleanup: true }) || '(앱 로그 없음)', { flag: 'wx' });
        check('시작된 앱의 비정상 종료 로그 없음', appCrash.length === 0, appCrash.slice(0, 2).join(' / '));
      } catch (error) {
        check('비정상 종료 로그 수집', false, error.message);
      }
    }
    metadata.sourceAtEnd = collectSourceIdentity(PROJECT_ROOT);
    if (metadata.source.manifestSha256 !== metadata.sourceAtEnd.manifestSha256) check('검증 중 소스 고정', false, '검증 도중 소스가 변경되었습니다.');
    if (sha256File(apk) !== metadata.apk.sha256) check('검증 중 APK 고정', false, '검증 도중 입력 APK가 변경되었습니다.');
    metadata.completedAt = new Date().toISOString();
    metadata.screenshots = screenshots;
    process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onInterrupt);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ ...metadata, results }, null, 2), { flag: 'wx' });
    const failed = results.filter(result => !result.ok).length;
    console.log(`\n${results.length - failed}/${results.length} trace/설치 항목 통과 · 스크린샷 독립 시각 검토는 별도`);
    return interrupted ? 130 : failed ? 1 : 0;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDeviceCheck().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
}
