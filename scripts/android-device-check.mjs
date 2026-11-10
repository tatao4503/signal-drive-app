// Android 기기·에뮬레이터 실행 검증.
//
// 연결된 기기 하나에 APK를 설치하고 시연 화면을 실제로 조작해 표시·보류·복구 규칙을 확인한다.
// 화면 구조(uiautomator)를 읽어 판정하므로 색 이름·초 숫자·접근성 설명이 "보이지 않는다"는 것까지 본다.
//
//   node scripts/android-device-check.mjs <apk> <결과폴더> [--serial emulator-5554] [--clock]
//
// --clock: 기기 시계를 뒤로 돌렸다 되돌려 과거 패킷 재표시를 확인한다. root가 되는
//          에뮬레이터(google_apis)에서만 쓴다. 끝나면 자동 시각 동기화를 되돌린다.
//
// 이 결과는 일반 Android(또는 AAOS 에뮬레이터) 실행 결과다. Pleos·실차 검증이 아니다.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const apk = args[0];
const outDir = args[1];
const serial = (args.find((a, i) => args[i - 1] === '--serial')) || null;
const withClock = args.includes('--clock');
if (!apk || !outDir || !existsSync(apk)) {
  console.error('사용법: node scripts/android-device-check.mjs <apk> <결과폴더> [--serial ID] [--clock]');
  process.exit(2);
}
const toolchain = path.resolve(root, '../toolchains/paths.json');
const sdk = process.env.ANDROID_HOME || (existsSync(toolchain) ? JSON.parse(readFileSync(toolchain, 'utf8')).sdk : null);
const adbPath = path.join(sdk || '', 'platform-tools', 'adb');
if (!existsSync(adbPath)) { console.error('adb가 없습니다. platform-tools를 설치하세요.'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const PKG = 'kr.signal.drive';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function adb(cmdArgs, opts = {}) {
  const full = serial ? ['-s', serial, ...cmdArgs] : cmdArgs;
  const r = spawnSync(adbPath, full, { encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`adb ${cmdArgs.join(' ')} 실패: ${r.stderr}`);
  return opts.binary ? r.stdout : (r.stdout || '').trim();
}
const shell = (cmd, opts) => adb(['shell', cmd], opts);

// ── 화면 읽기 ──
// 남은 초가 1초마다 바뀌는 동안 UI Automator는 화면을 읽지 못한다(1초 무변화를 기다린다).
// 그래서 앱의 검증용 화면 기록(log.tag.SignalDriveUi=DEBUG일 때만 남음)을 읽는다.
// 기록에는 화면에 실제로 보이는 문구, 초 숫자(보일 때만), 접근성 설명, 버튼 위치·활성 상태가 들어 있다.
function trace() {
  const lines = shell('logcat -d -s SignalDriveUi:I -v raw', { allowFail: true }).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1]);
}
function size() {
  // 회전·wm size를 반영한 현재 표시 크기. (물리 크기는 회전해도 그대로라 쓰면 안 된다)
  const m = shell('dumpsys window displays', { allowFail: true }).match(/cur=(\d+)x(\d+)/);
  return m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 2400 };
}
async function scroll(dir) {
  const { w, h } = size();
  const [y1, y2] = dir === 'down' ? [Math.round(h * 0.8), Math.round(h * 0.2)] : [Math.round(h * 0.2), Math.round(h * 0.8)];
  shell(`input swipe ${Math.round(w / 2)} ${y1} ${Math.round(w / 2)} ${y2} 250`);
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
  shell(`input tap ${n.x} ${n.y}`);
  await sleep(900);
  return n;
}
async function state() {
  await sleep(300);
  const t = trace() || {};
  return { source: t.source || '', phase: t.phase || '', seconds: t.seconds || '', secondsDesc: t.secondsDesc || '', reason: t.reason || '', ux: t.ux || '' };
}
async function shot(name) {
  const png = adb(['exec-out', 'screencap', '-p'], { binary: true });
  writeFileSync(path.join(outDir, `${name}.png`), png);
}

// ── 판정 ──
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const shown = (s) => /^(녹색|적색|황색) 신호$/.test(s.phase) && /^\d+초$/.test(s.seconds) && /잔여시간 \d+초/.test(s.secondsDesc);
const hidden = (s) => s.phase.replace(/\s+/g, ' ') === '현재 신호 확인 불가' && !s.seconds && !s.secondsDesc;

async function main() {
  const devices = spawnSync(adbPath, ['devices'], { encoding: 'utf8' }).stdout.split('\n').slice(1).filter((l) => /\tdevice$/.test(l));
  if (devices.length === 0) throw new Error('연결된 기기·에뮬레이터가 없습니다');
  const model = shell('getprop ro.product.model');
  const release = shell('getprop ro.build.version.release');
  const sdkInt = shell('getprop ro.build.version.sdk');
  const automotive = shell('pm has-feature android.hardware.type.automotive', { allowFail: true }).includes('true');
  console.log(`기기: ${model} · Android ${release} (API ${sdkInt}) · automotive=${automotive}`);

  adb(['install', '-r', '-g', apk]);
  shell('setprop log.tag.SignalDriveUi DEBUG');
  shell('logcat -c', { allowFail: true });
  shell(`am force-stop ${PKG}`);
  shell(`am start -W -n ${PKG}/.MainActivity`, { allowFail: true });
  await sleep(2500);

  if (automotive) {
    // AAOS: 실제 차량 제한 상태가 확인되기 전까지 실시간 화면·잠금으로 시작해야 한다.
    let s = await state();
    await shot('aaos-start');
    check('AAOS 시작 — 시연 데이터가 아니라 실시간 화면', s.source.includes('실시간'), s.source);
    check('AAOS 시작 — 승인 매핑 없음 → 신호 표시 안 함', hidden(s), `${s.phase} / ${s.reason}`);

    // 주행 시험: 차량 HAL에 기어 D·주차 브레이크 해제를 넣는다(root 필요). 에뮬레이터 결과이며 실차가 아니다.
    adb(['root'], { allowFail: true }); await sleep(2500); adb(['wait-for-device']);
    const vhal = (prop, v) => shell(`cmd car_service inject-vhal-event ${prop} 0 ${v}`, { allowFail: true });
    const park = async () => { vhal('0x11200402', 'true'); vhal('0x11400400', '4'); await sleep(2500); };
    const drive = async () => { vhal('0x11400400', '8'); vhal('0x11200402', 'false'); await sleep(2500); };
    const top = () => shell('dumpsys activity activities | grep -m1 topResumedActivity', { allowFail: true });
    await park();
    await tap('시연 화면'); s = await state(); await shot('aaos-parked-demo');
    check('AAOS 정차 — 시연 화면 표시', s.source === '시연 데이터 · 실제 신호 아님' && shown(s), `${s.phase} ${s.seconds}`);
    await drive(); s = await state(); await shot('aaos-driving');
    check('AAOS 주행 — 플랫폼이 앱을 막지 않음(주행 허용 선언)', top().includes(PKG), top());
    check('AAOS 주행 — 주행 화면으로 전환', trace()?.driving === true);
    check('AAOS 주행 — 시연 데이터 자동 해제(가짜 신호 안 보임)', s.source.includes('실시간') && hidden(s), `${s.source} | ${s.phase}`);
    check('AAOS 주행 — 시연 콘솔·화면 전환 숨김', !trace()?.buttons.some((b) => b.text === '데이터 지연' || b.text === '시연 화면'));
    check('AAOS 주행 — 잠금 문구', s.ux.includes('설정 잠금'), s.ux);
    await park(); s = await state(); await shot('aaos-parked-again');
    check('AAOS 정차 복귀 — 일반 화면 복귀, 시연으로 자동 복귀 안 함', trace()?.driving === false && s.source.includes('실시간'), s.source);
    return;
  }

  // 1) 정상 시연
  let s = await state(); await shot('01-start');
  check('시작 화면 시연 표시', s.source === '시연 데이터 · 실제 신호 아님', s.source);
  check('정상 녹색 — 색·초·접근성 표시', shown(s) && s.phase.includes('녹색'), `${s.phase} ${s.seconds} [${s.secondsDesc}]`);

  // 2) 보류 시나리오
  const holds = ['데이터 지연', '연결 단절', '교차로 불일치', '방향 미확정', '미래 시각', '잔여시간 만료'];
  for (const [i, name] of holds.entries()) {
    await tap(name); s = await state(); await shot(`02-${i + 1}-${name.replace(/ /g, '')}`);
    check(`${name} — 색·초·접근성 문구 제거`, hidden(s), `${s.phase} | 초="${s.seconds}" | 설명="${s.secondsDesc}" | ${s.reason}`);
    check(`${name} — 시연 표시 유지`, s.source === '시연 데이터 · 실제 신호 아님');
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
    if (label === '주행') check('모의 주행 — 주행 화면(콘솔·교차로 정보 숨김)', trace()?.driving === true && !trace()?.buttons.some((b) => b.text === '데이터 지연'));
    check(`모의 ${label} — 눌러도 시나리오 안 바뀜(녹색 유지)`, shown(s) && s.phase.includes('녹색'), s.phase);
    check(`모의 ${label} — 잠금 문구`, s.ux.includes('설정 잠금'), s.ux);
  }
  await tap('정차');
  const unlocked = await find('데이터 지연');
  check('모의 정차 — 시연 버튼 다시 활성', unlocked?.enabled === true);

  // 5) 백그라운드 → 복귀
  await tap('정상 녹색');
  shell('input keyevent KEYCODE_HOME'); await sleep(3000);
  shell(`am start -W -n ${PKG}/.MainActivity`, { allowFail: true }); await sleep(2000);
  s = await state(); await shot('05-resume');
  const secs = parseInt(s.seconds, 10);
  check('백그라운드 복귀 — 새 패킷으로 표시', shown(s), `${s.phase} ${s.seconds}`);
  check('백그라운드 복귀 — 잔여시간이 시연 창(24초) 안', secs > 0 && secs <= 24, s.seconds);

  // 6) 화면 크기 변경 + 스크롤
  shell('settings put system accelerometer_rotation 0'); shell('settings put system user_rotation 1'); await sleep(2000);
  s = await state(); await shot('06-landscape-top');
  check('가로 전환 — 앱 유지·시연 표시', s.source === '시연 데이터 · 실제 신호 아님');
  const footer = await reachFooter();
  await shot('06-landscape-bottom');
  check('가로 전환 — 맨 아래 안내까지 스크롤로 도달', Boolean(footer), `안내문 ${trace()?.footerBox}`);
  shell('wm size 720x1280'); await sleep(1500);
  const footerSmall = await reachFooter();
  await shot('06-small-bottom');
  check('작은 화면(720x1280) — 맨 아래까지 스크롤', Boolean(footerSmall), `${size().w}x${size().h} · 안내문 ${trace()?.footerBox}`);
  shell('wm size reset'); shell('settings put system user_rotation 0'); await sleep(1500);

  // 7) 시계 이상
  if (withClock) {
    const rooted = adb(['root'], { allowFail: true }); await sleep(2500);
    adb(['wait-for-device']);
    shell('settings put global auto_time 0', { allowFail: true });
    shell(`am start -W -n ${PKG}/.MainActivity`, { allowFail: true }); await sleep(1500);
    await tap('정상 녹색');
    const before = await state();
    check('시계 시험 전 — 표시 중', shown(before), before.seconds);
    const now = parseInt(shell('date +%s'), 10);
    shell(`date @${now - 3600}`, { allowFail: true }); await sleep(1500);
    s = await state(); await shot('07-clock-back');
    check('시계 1시간 뒤로 — 즉시 보류', hidden(s), `${s.phase} | ${s.reason}`);
    const now2 = parseInt(shell('date +%s'), 10);
    shell(`date @${now2 + 3600}`, { allowFail: true }); await sleep(2500);
    s = await state(); await shot('07-clock-restored');
    check('시계 복원 후 — 과거 패킷 자동 재표시 안 함', hidden(s), `${s.phase} | ${s.reason}`);
    await tap('정상 녹색'); s = await state();
    check('새 시연 입력 후 — 표시 재개', shown(s), s.seconds);
    shell('settings put global auto_time 1', { allowFail: true });
    check('(참고) root 획득', !/cannot|not/.test(rooted), rooted);
  }
}

main()
  .catch((e) => { check('검증 실행', false, e.message); })
  .finally(() => {
    const crashes = shell('logcat -d -b crash', { allowFail: true });
    const appCrash = crashes.split('\n').filter((l) => l.includes(PKG));
    writeFileSync(path.join(outDir, 'logcat-crash.txt'), crashes || '(없음)');
    writeFileSync(path.join(outDir, 'logcat-app.txt'), shell(`logcat -d --pid=$(pidof ${PKG})`, { allowFail: true }) || '(앱 로그 없음)');
    check('앱 비정상 종료 없음', appCrash.length === 0, appCrash.slice(0, 2).join(' / '));
    const failed = results.filter((r) => !r.ok).length;
    writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ apk: path.basename(apk), at: new Date().toISOString(), results }, null, 2));
    console.log(`\n${results.length - failed}/${results.length} 통과`);
    process.exit(failed ? 1 : 0);
  });
