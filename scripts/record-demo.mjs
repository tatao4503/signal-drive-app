// Isolated-emulator recording. UI trace is app-owned; recordings are separate visual evidence.
// node scripts/record-demo.mjs APK NEW_DIR --serial emulator-N [--aaos]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File, collectSourceIdentity } from './build-release.mjs';
import { shellQuote, selectDevice, parseInt32Property, parseWmOverride, validateSnapshot, buildRestoreCommands, executeRestoration } from './android-device-check.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PKG = 'kr.signal.drive';
export function parseRecordArgs(argv) {
  const [apk, outDir, ...rest] = argv;
  if (!apk || !outDir || apk.startsWith('--') || outDir.startsWith('--')) throw new Error('APK와 새 결과 폴더가 필요합니다.');
  let serial = null, aaos = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--serial' && !serial && rest[i + 1]) serial = rest[++i];
    else if (rest[i] === '--aaos' && !aaos) aaos = true;
    else throw new Error('녹화 옵션을 확인하세요.');
  }
  if (!/^emulator-\d+$/.test(serial || '')) throw new Error('--serial로 전용 에뮬레이터를 명시하세요.');
  return { apk: path.resolve(apk), outDir: path.resolve(outDir), serial, aaos };
}

export async function runRecording(argv = process.argv.slice(2)) {
  const { apk, outDir, serial, aaos } = parseRecordArgs(argv);
  if (!existsSync(apk) || !apk.endsWith('.apk')) throw new Error('APK 파일이 없습니다.');
  if (existsSync(outDir) && readdirSync(outDir).length) throw new Error('기존 녹화 결과를 덮어쓰지 않습니다. 새 폴더를 사용하세요.');
  const toolsFile = path.resolve(ROOT, '../toolchains/paths.json');
  const tools = existsSync(toolsFile) ? JSON.parse(readFileSync(toolsFile, 'utf8')) : {};
  if (!process.env.ANDROID_HOME && !tools.sdk) throw new Error('ANDROID_HOME을 설정하거나 로컬 SDK 경로를 준비하세요.');
  const adbPath = path.join(process.env.ANDROID_HOME || tools.sdk, 'platform-tools', 'adb');
  let interrupted = false, snapshot = null, touched = false, clockTouched = false, vehicleTouched = false, minimumTraceMs = 0;
  let activeRecorder = null;
  const clips = [];
  const temporaryFiles = new Set();
  const source = collectSourceIdentity(ROOT);
  const sourceBytes = `${JSON.stringify(source, null, 2)}\n`;
  const manifest = { schemaVersion: 1, completed: false, platform: aaos ? 'aaos' : 'phone', apkSha256: sha256File(apk), serial, sourceManifestFile: 'source-manifest.json', sourceManifestSha256: createHash('sha256').update(sourceBytes).digest('hex'), startedAt: new Date().toISOString(), clips, evidenceMethod: 'adb-screenrecord-and-app-owned-trace', limits: ['synthetic signal demonstration', 'no live traffic data received', 'not Pleos or a production vehicle', 'AAOS idling restriction only; sustained moving untested'] };
  function adb(args, { cleanup = false, allowFail = false, timeout = 45000, successCodes = [0] } = {}) {
    if (interrupted && !cleanup) throw new Error('녹화를 중단했습니다.');
    const result = spawnSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
    if ((!successCodes.includes(result.status) || result.error) && !allowFail) throw new Error(`adb 명령 실패: ${args[0]}`);
    return String(result.stdout || '').trim();
  }
  const shell = (command, options) => adb(['shell', command], options);
  const sleep = async ms => { await new Promise(resolve => setTimeout(resolve, ms)); if (interrupted) throw new Error('녹화를 중단했습니다.'); };
  const elapsed = () => {
    const result = Number(shell('cat /proc/uptime').split(/\s/)[0]);
    if (!Number.isFinite(result) || result < 0) throw new Error('기기의 경과 시간을 확인할 수 없습니다.');
    return Math.floor(result * 1000);
  };
  const mark = () => { minimumTraceMs = elapsed(); };
  const onInterrupt = () => { interrupted = true; };
  process.once('SIGINT', onInterrupt); process.once('SIGTERM', onInterrupt);
  function trace() {
    const pids = shell(`pidof ${PKG}`, { allowFail: true }).split(/\s+/).filter(x => /^\d+$/.test(x)).map(Number);
    if (!pids.length) return null;
    const lines = shell('logcat -d -s SignalDriveUi:I -v raw', { allowFail: true }).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const t = JSON.parse(lines[i]);
        if (pids.includes(t.processId) && t.traceElapsedMs >= minimumTraceMs) {
          if (t.windowFocused !== true) throw new Error('앱 창이 다른 시스템 창에 가려져 녹화를 중단했습니다.');
          return t;
        }
      } catch (error) { if (error.message?.includes('시스템 창')) throw error; }
    }
    return null;
  }
  async function waitFor(predicate, description, tries = 20) {
    for (let i = 0; i < tries; i++) { const t = trace(); if (t && predicate(t)) return t; await sleep(300); }
    throw new Error(`화면 상태를 확인하지 못했습니다: ${description}`);
  }
  function size() {
    const hit = shell('dumpsys window displays').match(/cur=(\d+)x(\d+)/);
    if (!hit) throw new Error('현재 화면 크기를 확인하지 못했습니다.');
    return { w: Number(hit[1]), h: Number(hit[2]) };
  }
  async function scroll(up = false) {
    const { w, h } = size(); mark();
    shell(`input swipe ${Math.round(w / 2)} ${Math.round(h * (up ? 0.2 : 0.8))} ${Math.round(w / 2)} ${Math.round(h * (up ? 0.8 : 0.2))} 250`);
    await sleep(400);
  }
  async function toTop() {
    for (let i = 0; i < 5; i++) { const t = trace(); if (t?.sourceOnScreen && t?.phaseOnScreen) return; await scroll(true); }
    await waitFor(t => t.sourceOnScreen && t.phaseOnScreen, '신호 카드와 출처');
  }
  async function find(text) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 10; i++) {
        const b = trace()?.buttons?.find(item => item.text === text && item.onScreen && item.enabled);
        if (b) return b;
        await scroll(pass === 1);
      }
    }
    throw new Error(`화면에서 활성 버튼을 찾지 못했습니다: ${text}`);
  }
  async function tap(text, top = true) {
    const b = await find(text); mark(); shell(`input tap ${b.x} ${b.y}`); await sleep(500);
    if (top) await toTop();
  }
  async function record(filename, durationSeconds, action) {
    const remote = `/sdcard/signal-${process.pid}-${filename}`;
    temporaryFiles.add(remote);
    const before = performance.now();
    const recorder = spawn(adbPath, ['-s', serial, 'shell', 'screenrecord', '--time-limit', String(durationSeconds), '--bit-rate', '8000000', remote], { stdio: ['ignore', 'pipe', 'pipe'] });
    activeRecorder = recorder;
    let errorText = '';
    recorder.stderr.on('data', data => { errorText += data.toString().slice(0, 1000); });
    const done = new Promise((resolve, reject) => { recorder.once('error', reject); recorder.once('exit', code => code === 0 ? resolve() : reject(new Error(`screenrecord 실패 (${code}): ${errorText.slice(0, 100)}`))); });
    // Observe rejection even if an action fails before waiting for completion.
    done.catch(() => {});
    let lead = 0, timeoutHandle;
    try {
      await sleep(1000);
      if (action) await action((performance.now() - before) / 1000);
      lead = (performance.now() - before) / 1000 + 0.2;
      await Promise.race([done, new Promise((_, reject) => { timeoutHandle = setTimeout(() => reject(new Error('screenrecord 제한시간 초과')), (durationSeconds + 15) * 1000); })]);
      activeRecorder = null;
      const destination = path.join(outDir, filename);
      adb(['pull', remote, destination]);
      if (!existsSync(destination) || readFileSync(destination).length === 0) throw new Error('녹화 파일이 비었습니다.');
      shell(`rm -- ${shellQuote(remote)}`); temporaryFiles.delete(remote);
      return { file: filename, lead, sha256: sha256File(destination), requestedDurationSeconds: durationSeconds };
    } finally {
      clearTimeout(timeoutHandle);
      if (activeRecorder === recorder) {
        // This signal targets only this adb child. Never kill unrelated device processes.
        recorder.kill('SIGINT');
        await Promise.race([done.catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
        activeRecorder = null;
      }
    }
  }
  function shot(filename) {
    const result = spawnSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
    if (result.status !== 0 || result.error || !result.stdout?.length) throw new Error('전환 화면 캡처 실패');
    writeFileSync(path.join(outDir, filename), result.stdout, { flag: 'wx' });
    return { file: filename, sha256: createHash('sha256').update(result.stdout).digest('hex'), independentVisualReview: 'not-performed-by-script' };
  }
  const vhal = (property, value) => { vehicleTouched = true; mark(); shell(`cmd car_service inject-vhal-event ${property} 0 ${value}`); };
  async function park(observe = true) { vhal('0x11200402', 'true'); vhal('0x11400400', '4'); await sleep(1500); if (observe) await waitFor(t => !t.driving, '정차'); }
  async function restrictIdling() { vhal('0x11400400', '8'); vhal('0x11200402', 'false'); await sleep(1500); await waitFor(t => t.driving && t.source.includes('실시간') && !t.seconds, '공회전 제한·시연 해제'); }
  try {
    const list = spawnSync(adbPath, ['devices'], { encoding: 'utf8', timeout: 15000 });
    if (list.status !== 0) throw new Error('기기 목록을 확인할 수 없습니다.');
    selectDevice(list.stdout, serial);
    if (shell('getprop ro.kernel.qemu') !== '1') throw new Error('전용 qemu 에뮬레이터에서만 녹화합니다.');
    const automotiveFlag = shell('pm has-feature android.hardware.type.automotive', { successCodes: [0, 1] });
    if (!['true', 'false'].includes(automotiveFlag)) throw new Error('차량 기기 종류를 확인할 수 없습니다.');
    const automotive = automotiveFlag === 'true';
    if (automotive !== aaos) throw new Error('--aaos 옵션과 실제 기기 종류가 다릅니다.');
    manifest.avdName = shell('getprop ro.boot.qemu.avd_name') || adb(['emu', 'avd', 'name']).split('\n').find(line => line && line !== 'OK');
    if (!manifest.avdName) throw new Error('격리 AVD 이름을 확인할 수 없습니다.');
    snapshot = validateSnapshot({ rotationAuto: shell('settings get system accelerometer_rotation'), rotationUser: shell('settings get system user_rotation'), autoTime: shell('settings get global auto_time'), wmSizeOverride: parseWmOverride(shell('wm size')), debugLogProperty: shell('getprop log.tag.SignalDriveUi'), epochSeconds: Number(shell('date +%s')), elapsedMs: performance.now() });
    if (aaos) snapshot.vhal = { gear: parseInt32Property(shell('cmd car_service get-property-value 0x11400400 0')), parkingBrake: parseInt32Property(shell('cmd car_service get-property-value 0x11200402 0')) };
    validateSnapshot(snapshot);
    adb(['root']); await sleep(2000); adb(['wait-for-device']);
    if (shell('id -u') !== '0') throw new Error('이 전용 에뮬레이터에서 root를 사용할 수 없습니다.');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'source-manifest.json'), sourceBytes, { flag: 'wx' });
    adb(['install', '-r', '-g', apk], { timeout: 120000 });
    const dump = shell(`dumpsys package ${PKG}`);
    manifest.versionName = dump.match(/\bversionName=([^\s]+)/)?.[1];
    manifest.versionCode = Number(dump.match(/\bversionCode=(\d+)/)?.[1]);
    if (manifest.versionName !== '0.2.1' || manifest.versionCode !== 3) throw new Error('0.2.1 versionCode3 설치본이 아닙니다.');
    const packagePaths = shell(`pm path ${PKG}`).split('\n').map(line => line.match(/^package:(.+)$/)?.[1]).filter(Boolean);
    if (packagePaths.length !== 1) throw new Error('단일 설치 APK를 특정할 수 없습니다.');
    manifest.installedApkSha256 = shell(`sha256sum ${shellQuote(packagePaths[0])}`).match(/^([0-9a-f]{64})\s/i)?.[1]?.toLowerCase();
    if (manifest.installedApkSha256 !== manifest.apkSha256) throw new Error('입력·설치 APK 해시가 다릅니다.');
    touched = true;
    shell('setprop log.tag.SignalDriveUi DEBUG');
    shell('settings put system accelerometer_rotation 0');
    if (!aaos) { shell('settings put system user_rotation 0'); clockTouched = true; shell('settings put global auto_time 0'); }
    if (aaos) await park(false);
    shell(`am force-stop ${PKG}`); shell('logcat -c'); mark();
    shell(`am start -W -n ${PKG}/.MainActivity`); await sleep(2000);
    await waitFor(t => t.sourceOnScreen && t.phaseOnScreen, '새 프로세스의 시작 화면');
    if (aaos) {
      if (!trace()?.source.includes('실시간')) await tap('실시간 연결 상태');
      clips.push(await record('aaos-1-live.mp4', 8));
      await tap('시연 화면');
      const transitions = [];
      const recorded = await record('aaos-2-drive.mp4', 23, async initialLead => {
        const start = performance.now() - initialLead * 1000;
        const waitAt = async seconds => { const ms = seconds * 1000 - (performance.now() - start); if (ms > 0) await sleep(ms); };
        transitions.push({ state: 'parked-demo', seconds: 0, trace: trace(), screenshot: shot('aaos-parked-demo.png') });
        await waitAt(5.6); const commanded = (performance.now() - start) / 1000;
        await restrictIdling(); await toTop();
        transitions.push({ state: 'idling-restricted', commandedAtSeconds: commanded, seconds: (performance.now() - start) / 1000, trace: trace(), screenshot: shot('aaos-idling-restricted.png') });
        await waitAt(14.4); const parkedCommand = (performance.now() - start) / 1000;
        await park(); await toTop();
        transitions.push({ state: 'parked-live', commandedAtSeconds: parkedCommand, seconds: (performance.now() - start) / 1000, trace: trace(), screenshot: shot('aaos-parked-live.png') });
      });
      recorded.lead = 0; recorded.transitions = transitions; clips.push(recorded); manifest.aaosTransitions = transitions;
    } else {
      const cases = [['01-green','정상 녹색'],['02-delay','데이터 지연'],['03-recover','복구'],['04-disconnect','연결 단절'],['05-mismatch','교차로 불일치'],['06-direction','방향 미확정'],['07-expired','잔여시간 만료'],['08-recover','복구']];
      for (const [name, label] of cases) {
        await tap(label); const item = await record(`clip-${name}.mp4`, 9); item.caption = label; clips.push(item); console.log(`${name}: ${label}`);
      }
      // Reach the control before recording, then show the compact screen throughout the clip.
      const drive = await find('주행');
      clips.push(await record('clip-09-driving.mp4', 10, async () => { mark(); shell(`input tap ${drive.x} ${drive.y}`); await sleep(600); await toTop(); await waitFor(t => t.driving && t.drivingNoticeOnScreen, '모의 주행 안내'); }));
      await tap('정차'); await tap('정상 녹색');
      clips.push(await record('clip-10-clock-back.mp4', 9, async () => { const now = Number(shell('date +%s')); if (!Number.isSafeInteger(now)) throw new Error('시각 확인 실패'); mark(); shell(`date @${now - 3600}`); await waitFor(t => !t.seconds && t.reason.includes('시각 변경'), '시각 역행 보류'); }));
      clips.push(await record('clip-11-clock-restore.mp4', 9, async () => { const now = Number(shell('date +%s')); if (!Number.isSafeInteger(now)) throw new Error('시각 확인 실패'); mark(); shell(`date @${now + 3600}`); await waitFor(t => !t.seconds && t.reason.includes('시각 변경'), '복원 뒤 보류 유지'); }));
      await tap('정상 녹색'); clips.push(await record('clip-12-new-data.mp4', 9));
      writeFileSync(path.join(outDir, 'phone-clips.json'), JSON.stringify(clips, null, 2) + '\n', { flag: 'wx' });
    }
    if (collectSourceIdentity(ROOT).manifestSha256 !== source.manifestSha256 || sha256File(apk) !== manifest.apkSha256) throw new Error('녹화 중 소스 또는 APK가 변경되었습니다.');
    manifest.completed = true;
  } catch (error) {
    manifest.error = error.message;
    console.error(error.message);
  } finally {
    // Restoration runs before evidence writes so a full disk cannot bypass cleanup.
    if (activeRecorder) activeRecorder.kill('SIGINT');
    manifest.restoration = touched && snapshot ? executeRestoration(buildRestoreCommands(snapshot, { restoreClock: clockTouched, restoreVehicle: vehicleTouched }), command => shell(command, { cleanup: true })) : { ok: true, steps: [], reason: 'settings-not-modified' };
    for (const remote of temporaryFiles) { try { shell(`rm -- ${shellQuote(remote)}`, { cleanup: true }); } catch { } }
    if (!manifest.restoration.ok) manifest.completed = false;
    manifest.completedAt = new Date().toISOString();
    process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onInterrupt);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'recording-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(`녹화 ${clips.length}개 · completed=${manifest.completed}`);
  return interrupted ? 130 : manifest.completed ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRecording().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
}
