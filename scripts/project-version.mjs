import { readFileSync } from 'node:fs';
import path from 'node:path';

const VERSION_NAME = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The recorder's expected APK contract follows the declared project, never an old release. */
export function parseProjectVersion(packageText, gradleText) {
  const packageVersion = JSON.parse(packageText).version;
  const names = [...gradleText.matchAll(/^\s*versionName\s*=\s*"([^"]+)"\s*(?:\/\/[^\n]*)?$/gm)];
  const codes = [...gradleText.matchAll(/^\s*versionCode\s*=\s*(\d+)\s*(?:\/\/[^\n]*)?$/gm)];
  if (typeof packageVersion !== 'string' || !VERSION_NAME.test(packageVersion)
      || names.length !== 1 || codes.length !== 1 || names[0][1] !== packageVersion) {
    throw new Error('package.json과 Android의 versionName을 하나의 같은 버전으로 맞춰야 합니다.');
  }
  const versionCode = Number(codes[0][1]);
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) throw new Error('Android versionCode가 올바른 양의 정수가 아닙니다.');
  return { versionName: packageVersion, versionCode };
}

export function readProjectVersion(root) {
  return parseProjectVersion(readFileSync(path.join(root, 'package.json'), 'utf8'),
    readFileSync(path.join(root, 'app/build.gradle.kts'), 'utf8'));
}

export function assertInstalledVersion(expected, installed) {
  if (installed.versionName !== expected.versionName || installed.versionCode !== expected.versionCode) {
    throw new Error(`${expected.versionName} versionCode${expected.versionCode} 설치본이 아닙니다.`);
  }
}
