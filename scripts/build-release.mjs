// 제출용 release APK 빌드.
//
// 공모전 요건: "실행 가능한 release 버전", 파일명 `팀명_앱이름_release.apk`.
// debug APK 이름만 바꾸는 것은 release가 아니다. 이 스크립트는 :app:assembleRelease를
// 실제로 빌드하고, apksigner로 서명을 검사한 뒤에만 제출용 이름으로 복사한다.
//
// 서명 정보는 환경변수로만 받는다(소스·로그·ZIP에 남기지 않는다):
//   SIGNAL_RELEASE_STORE_FILE      키스토어 경로(작업본 밖 권장)
//   SIGNAL_RELEASE_STORE_PASSWORD
//   SIGNAL_RELEASE_KEY_ALIAS
//   SIGNAL_RELEASE_KEY_PASSWORD
//   SIGNAL_RELEASE_TEAM            파일명용 팀명(선택, 없으면 이름 붙이기를 건너뛴다)
//   SIGNAL_RELEASE_OUT             복사할 폴더(선택)

import { existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const toolchainFile = [path.resolve(root, '../toolchains/paths.json')].find(existsSync);
const tools = toolchainFile ? JSON.parse(readFileSync(toolchainFile, 'utf8')) : {};
const env = { ...process.env };
env.JAVA_HOME ||= tools.jdk;
env.ANDROID_HOME ||= tools.sdk;
env.GRADLE_USER_HOME ||= tools.gradle ? path.resolve(root, '../toolchains/gradle-cache') : path.join(root, '.local/gradle-cache');
if (!env.JAVA_HOME || !existsSync(env.JAVA_HOME)) throw new Error('JDK 17의 JAVA_HOME이 필요합니다.');
if (!env.ANDROID_HOME || !existsSync(env.ANDROID_HOME)) throw new Error('Android SDK 경로 ANDROID_HOME이 필요합니다.');

const signingKeys = ['SIGNAL_RELEASE_STORE_FILE', 'SIGNAL_RELEASE_STORE_PASSWORD', 'SIGNAL_RELEASE_KEY_ALIAS', 'SIGNAL_RELEASE_KEY_PASSWORD'];
const missing = signingKeys.filter((k) => !env[k]);
if (env.SIGNAL_RELEASE_STORE_FILE && !existsSync(env.SIGNAL_RELEASE_STORE_FILE)) {
  console.error('키스토어 파일을 찾을 수 없습니다. SIGNAL_RELEASE_STORE_FILE 경로를 확인하세요.');
  process.exit(1);
}
const storeInside = env.SIGNAL_RELEASE_STORE_FILE && path.resolve(env.SIGNAL_RELEASE_STORE_FILE).startsWith(path.resolve(root));
if (storeInside) {
  console.error('키스토어가 작업본 안에 있습니다. 소스 ZIP에 섞이지 않도록 작업본 밖으로 옮기세요.');
  process.exit(1);
}

const gradle = tools.gradle && existsSync(tools.gradle) ? tools.gradle : path.join(root, 'gradlew');
const build = spawnSync(gradle, ['--no-daemon', '--console=plain', ':core:verifyCore', ':app:assembleRelease'], { cwd: root, env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);

const outDir = path.join(root, 'app/build/outputs/apk/release');
const apks = existsSync(outDir) ? readdirSync(outDir).filter((n) => n.endsWith('.apk')) : [];
if (apks.length !== 1) {
  console.error(`release APK를 하나로 특정할 수 없습니다: ${apks.join(', ') || '없음'}`);
  process.exit(1);
}
const apk = path.join(outDir, apks[0]);

if (missing.length) {
  console.log(`\nrelease 빌드 성공: ${path.relative(root, apk)}`);
  console.log('서명 없음 — 설치할 수 없어 제출용이 아닙니다.');
  console.log(`필요한 환경변수: ${missing.join(', ')}`);
  process.exit(0);
}

const buildTools = path.join(env.ANDROID_HOME, 'build-tools');
const btVersion = readdirSync(buildTools).sort().pop();
const apksigner = path.join(buildTools, btVersion, 'apksigner');
const verify = spawnSync(apksigner, ['verify', '--print-certs', '--min-sdk-version', '28', apk], { env, encoding: 'utf8' });
if (verify.status !== 0) {
  console.error('apksigner 검사 실패 — 제출할 수 없습니다.');
  console.error(verify.stderr);
  process.exit(1);
}
// 인증서 주체가 Android Debug면 release 키가 아니다.
if (/CN=Android Debug/.test(verify.stdout)) {
  console.error('debug 인증서로 서명돼 있습니다. release 키가 아닙니다.');
  process.exit(1);
}
const subject = (verify.stdout.match(/certificate DN: (.*)/) || [])[1] || '(확인 불가)';
console.log(`\n서명 검사 통과 · 인증서 주체: ${subject}`);

if (env.SIGNAL_RELEASE_TEAM && env.SIGNAL_RELEASE_OUT) {
  const name = `${env.SIGNAL_RELEASE_TEAM}_SIGNALDrive_release.apk`;
  mkdirSync(env.SIGNAL_RELEASE_OUT, { recursive: true });
  const dest = path.join(env.SIGNAL_RELEASE_OUT, name);
  copyFileSync(apk, dest);
  console.log(`제출용 이름으로 복사: ${dest}`);
} else {
  console.log(`release APK: ${apk}`);
  console.log('제출용 이름(팀명_앱이름_release.apk)으로 복사하려면 SIGNAL_RELEASE_TEAM·SIGNAL_RELEASE_OUT을 지정하세요.');
}
