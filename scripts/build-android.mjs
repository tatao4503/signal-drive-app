import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const toolchainFile = [path.resolve(root, '../toolchains/paths.json'), path.resolve(root, '../../work/toolchains/paths.json')].find(existsSync);
const tools = toolchainFile ? JSON.parse(readFileSync(toolchainFile, 'utf8')) : {};
const env = { ...process.env };
env.JAVA_HOME ||= tools.jdk;
env.ANDROID_HOME ||= tools.sdk;
env.GRADLE_USER_HOME ||= tools.gradle ? path.resolve(root, '../toolchains/gradle-cache') : path.join(root, '.local/gradle-cache');
if (!env.JAVA_HOME || !existsSync(env.JAVA_HOME)) throw new Error('JDK 17의 JAVA_HOME을 설정하거나 Android Studio에서 프로젝트를 여세요.');
if (!env.ANDROID_HOME || !existsSync(env.ANDROID_HOME)) throw new Error('Android SDK 경로 ANDROID_HOME을 설정하거나 Android Studio에서 API 34 extension 12를 설치하세요.');
mkdirSync(path.join(root, '.local'), { recursive: true });
writeFileSync(path.join(root, 'local.properties'), `sdk.dir=${env.ANDROID_HOME.replaceAll('\\', '/') }\n`);
const executable = name => path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
const signingFile = path.join(root, '.local/debug.keystore');
if (!existsSync(signingFile)) {
  const key = spawnSync(executable('keytool'), ['-genkeypair', '-keystore', signingFile, '-storepass', 'android', '-alias', 'androiddebugkey', '-keypass', 'android', '-dname', 'CN=Android Debug,O=Android,C=US', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000'], { cwd: root, env, stdio: 'inherit' });
  if (key.status !== 0) process.exit(key.status || 1);
}
const gradle = tools.gradle && existsSync(tools.gradle) ? tools.gradle : path.join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
if (!existsSync(gradle)) throw new Error('Gradle wrapper가 없습니다. Android Studio에서 Gradle 8.9로 동기화하세요.');
const result = spawnSync(gradle, ['--no-daemon', '--console=plain', ':core:verifyCore', ':app:assembleDebug'], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status || (result.error ? 1 : 0));
