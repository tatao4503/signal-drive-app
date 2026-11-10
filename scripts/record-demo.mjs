// 시연 영상 녹화 (일반 Android 에뮬레이터, 세로).
//
//   node scripts/record-demo.mjs <apk> <결과폴더> [--serial emulator-5554]
//
// 시연 버튼을 순서대로 누르며 화면을 녹화하고, 장면마다 시작 시각과 자막을 scenes.json에 남긴다.
// root가 되는 에뮬레이터에서 시계 장면까지 찍는다. 이 영상은 에뮬레이터 화면이며 Pleos·실차가 아니다.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const [apk, outDir] = args;
const serial = args.find((a, i) => args[i - 1] === '--serial') || 'emulator-5554';
if (!apk || !outDir || !existsSync(apk)) { console.error('사용법: node scripts/record-demo.mjs <apk> <결과폴더>'); process.exit(2); }
const sdk = JSON.parse(readFileSync(path.resolve(root, '../toolchains/paths.json'), 'utf8')).sdk;
const adbPath = path.join(sdk, 'platform-tools', 'adb');
mkdirSync(outDir, { recursive: true });
const PKG = 'kr.signal.drive';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (a, allowFail = true) => { const r = spawnSync(adbPath, ['-s', serial, ...a], { encoding: 'utf8' }); if (r.status && !allowFail) throw new Error(r.stderr); return (r.stdout || '').trim(); };
const shell = (c) => adb(['shell', c]);
const trace = () => { const l = shell('logcat -d -s SignalDriveUi:I -v raw').split('\n').filter((x) => x.trim().startsWith('{')); return l.length ? JSON.parse(l[l.length - 1]) : null; };
async function tap(text) {
  // 신호 카드 높이가 상태마다 달라 아래 버튼이 화면 밖으로 밀릴 수 있다 → 조금씩 내려 맞춘다
  let b = trace()?.buttons.find((x) => x.text === text && x.onScreen);
  for (let i = 0; !b && i < 4; i++) { shell('input swipe 540 1700 540 1450 400'); await sleep(700); b = trace()?.buttons.find((x) => x.text === text && x.onScreen); }
  if (!b) throw new Error(`"${text}" 버튼이 화면에 없습니다`);
  shell(`input tap ${b.x} ${b.y}`);
  await sleep(400);
}

// 준비: root(시계 장면용), 설치, 화면 기록 켜기
adb(['root']); await sleep(3000); adb(['wait-for-device']);
adb(['uninstall', PKG]);
adb(['install', '-g', apk], false);
shell('setprop log.tag.SignalDriveUi DEBUG');
shell('settings put global auto_time 0');
shell('settings put system user_rotation 0');
shell('logcat -c');
shell(`am start -W -n ${PKG}/.MainActivity`);
await sleep(2500);
// 정차·시연 버튼이 다 보이도록 살짝 내린다(신호 카드는 화면에 남는다)
for (let i = 0; i < 6 && !trace()?.buttons.find((x) => x.text === '주행' && x.onScreen); i++) { shell('input swipe 540 1700 540 1450 500'); await sleep(900); }
if (!trace()?.buttons.find((x) => x.text === '주행' && x.onScreen)) throw new Error('모의 차량 버튼을 화면에 올리지 못했습니다');

// 장면마다 따로 녹화한다. 화면이 멈춰 있으면 screenrecord가 프레임을 만들지 않아
// 한 번에 길게 찍으면 자막 시각이 밀린다. 클립 하나 = 장면 하나 = 자막 하나.
const clips = [];
async function clip(name, caption, act, holdMs) {
  const file = `/sdcard/clip-${name}.mp4`;
  // 강제 종료(pkill)하면 시계 변경 뒤 파일이 깨진 적이 있어, 길이를 정해 두고 스스로 끝나게 한다.
  const limit = Math.ceil((1500 + holdMs + 4000) / 1000);
  const rec = spawn(adbPath, ['-s', serial, 'shell', 'screenrecord', '--time-limit', String(limit), '--bit-rate', '8000000', file]);
  const done = new Promise((r) => rec.on('exit', r));
  await sleep(1500);
  await act();
  await Promise.race([done, sleep(limit * 1000 + 5000)]);
  await sleep(800);
  adb(['pull', file, path.join(outDir, `clip-${name}.mp4`)], false);
  shell(`rm ${file}`);
  clips.push({ file: `clip-${name}.mp4`, caption, lead: 1.2 });
  console.log(`${name}: ${caption}`);
}

await clip('01-green', '시연 데이터 · 확인된 신호는 색과 남은 시간을 함께 보여줍니다', () => tap('정상 녹색'), 4000);
await clip('02-delay', '데이터가 늦게 오면 → 색과 숫자를 지우고 이유만 보여줍니다', () => tap('데이터 지연'), 3500);
await clip('03-recover', '새 데이터가 오면 다시 표시합니다', () => tap('복구'), 3000);
await clip('04-disconnect', '연결이 끊기면 → 표시 중단', () => tap('연결 단절'), 3000);
await clip('05-mismatch', '다른 교차로의 데이터는 쓰지 않습니다', () => tap('교차로 불일치'), 3000);
await clip('06-direction', '진입 방향을 모르면 표시하지 않습니다', () => tap('방향 미확정'), 3000);
await clip('07-expired', '유효시간이 끝난 신호로 다음 색을 추측하지 않습니다', () => tap('잔여시간 만료'), 3000);
await clip('08-recover', '새 데이터가 오면 다시 표시합니다', () => tap('복구'), 2500);
await clip('09-driving', '주행 중에는 신호·남은 시간·이유만 남기고\n설정과 시연 입력을 잠급니다', async () => {
  await tap('주행');
}, 2500);
await tap('정차'); await sleep(500); await tap('정상 녹색'); await sleep(1000);
await clip('10-clock-back', '기기 시계가 바뀌면 즉시 보류합니다', async () => {
  const now = parseInt(shell('date +%s'), 10); shell(`date @${now - 3600}`);
}, 3500);
await clip('11-clock-restore', '시계를 되돌려도 지난 신호를 다시 꺼내지 않습니다', async () => {
  const now = parseInt(shell('date +%s'), 10); shell(`date @${now + 3600}`);
}, 3500);
await clip('12-new-data', '새 데이터가 들어온 뒤에만 다시 표시합니다', () => tap('정상 녹색'), 3500);

shell('settings put global auto_time 1');
writeFileSync(path.join(outDir, 'phone-clips.json'), JSON.stringify(clips, null, 2));
console.log(`클립 ${clips.length}개`);
