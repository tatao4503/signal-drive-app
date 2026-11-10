// Release workflow. Never reads keystore bytes, logs credentials, or replaces an old deliverable.
import { constants, existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SIGNING_NAMES = ['SIGNAL_RELEASE_STORE_FILE', 'SIGNAL_RELEASE_STORE_PASSWORD', 'SIGNAL_RELEASE_KEY_ALIAS', 'SIGNAL_RELEASE_KEY_PASSWORD'];
const PUBLIC_SOURCE_ROOTS = new Set(['app', 'core', 'scripts', 'server', 'shared', 'tests', 'web', 'gradle']);
const PUBLIC_ROOT_FILES = new Set(['.gitignore', 'README.md', 'THIRD_PARTY_NOTICES.md', 'build.gradle.kts', 'gradle.properties', 'gradlew', 'gradlew.bat', 'package.json', 'settings.gradle.kts', '검증결과.md', '시작.command']);
const BLOCKED_PARTS = new Set(['.local', '.git', '.gradle', 'build', 'node_modules', 'keys', 'keystores', '.logs', 'apk', 'demo', '__pycache__']);

export function sha256File(filename) { return createHash('sha256').update(readFileSync(filename)).digest('hex'); }
export function signingState(env) {
  const missing = SIGNING_NAMES.filter(name => typeof env[name] !== 'string' || env[name].length === 0);
  return { kind: missing.length === 0 ? 'complete' : missing.length === SIGNING_NAMES.length ? 'none' : 'partial', missing };
}
export function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function assertExternalKeystore(root, filename) {
  // Resolving a link reads metadata, never the key material.
  const actualRoot = realpathSync(root);
  const actualFile = realpathSync(filename);
  if (!statSync(actualFile).isFile()) throw new Error('키스토어 경로가 일반 파일이 아닙니다.');
  if (isPathWithin(actualRoot, actualFile)) throw new Error('키스토어는 작업본 밖에 두어야 합니다. 심볼릭 링크의 실제 위치도 확인하세요.');
  return actualFile;
}
export function publicSourcePath(relative) {
  const parts = relative.split(/[\\/]/);
  return !parts.some(part => BLOCKED_PARTS.has(part) || part.endsWith('.nosync') || part.startsWith('.env') || /\.(?:jks|keystore|pem|p12|pfx|pyc)$/i.test(part))
    && (parts.length === 1 ? PUBLIC_ROOT_FILES.has(parts[0]) : PUBLIC_SOURCE_ROOTS.has(parts[0]));
}
export function collectSourceIdentity(root, run = spawnSync) {
  const files = [];
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const parts = relative.split('/');
        if (!parts.some(part => BLOCKED_PARTS.has(part) || part.endsWith('.nosync') || part.startsWith('.env')) && PUBLIC_SOURCE_ROOTS.has(parts[0])) visit(path.join(directory, entry.name), relative);
      } else if (entry.isFile() && publicSourcePath(relative)) {
        files.push({ path: relative, sha256: sha256File(path.join(root, relative)) });
      }
    }
  }
  visit(root);
  const execute = args => run('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const top = execute(['rev-parse', '--show-toplevel']);
  const ownsRepository = top.status === 0 && path.resolve(top.stdout.trim()) === path.resolve(root);
  const revision = ownsRepository ? execute(['rev-parse', 'HEAD']) : null;
  const dirty = ownsRepository ? execute(['status', '--porcelain=v1', '--untracked-files=normal']) : null;
  return {
    gitRevision: revision?.status === 0 && /^[0-9a-f]{40,64}$/.test(revision.stdout.trim()) ? revision.stdout.trim() : null,
    workingTreeDirty: dirty?.status === 0 ? dirty.stdout.trim().length > 0 : null,
    manifestSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files,
  };
}
export function newestBuildTools(sdkRoot) {
  const root = path.join(sdkRoot, 'build-tools');
  const versions = readdirSync(root).filter(name => /^\d+\.\d+\.\d+$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error('Android build-tools를 찾을 수 없습니다.');
  return path.join(root, versions.at(-1));
}
export function parseCertificate(output) {
  return {
    sha256: output.match(/certificate SHA-256 digest:\s*([0-9a-f]{64})/i)?.[1]?.toLowerCase() || null,
    isDebugCertificate: /certificate DN:.*CN\s*=\s*Android Debug(?:,|\s*$)/im.test(output),
  };
}
export function exclusiveCopy(source, destination) {
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
}

export function runRelease(argv = process.argv.slice(2), runtimeEnv = process.env, run = spawnSync) {
  const unsigned = argv.includes('--unsigned');
  const testSignature = argv.includes('--test-signature');
  const identityIndex = argv.indexOf('--identity-json');
  const identityPath = identityIndex >= 0 ? argv[identityIndex + 1] : null;
  const accepted = new Set(['--unsigned', '--test-signature', '--identity-json']);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--identity-json') { if (!argv[++i] || argv[i].startsWith('--')) throw new Error('--identity-json 경로가 필요합니다.'); continue; }
    if (!accepted.has(argv[i])) throw new Error('지원하지 않는 release 옵션입니다.');
  }
  if (unsigned && testSignature) throw new Error('unsigned와 test-signature 옵션을 함께 사용할 수 없습니다.');
  if (identityPath && existsSync(identityPath)) throw new Error('기존 빌드 근거 파일을 덮어쓰지 않습니다. 새 --identity-json 경로를 사용하세요.');
  const env = { ...runtimeEnv };
  const toolchainFile = path.resolve(PROJECT_ROOT, '../toolchains/paths.json');
  const tools = existsSync(toolchainFile) ? JSON.parse(readFileSync(toolchainFile, 'utf8')) : {};
  env.JAVA_HOME ||= tools.jdk;
  env.ANDROID_HOME ||= tools.sdk;
  env.GRADLE_USER_HOME ||= tools.gradle ? path.resolve(PROJECT_ROOT, '../toolchains/gradle-cache') : path.join(PROJECT_ROOT, '.local/gradle-cache');
  if (!env.JAVA_HOME || !existsSync(env.JAVA_HOME)) throw new Error('JDK 17의 JAVA_HOME이 필요합니다.');
  if (!env.ANDROID_HOME || !existsSync(env.ANDROID_HOME)) throw new Error('Android SDK의 ANDROID_HOME이 필요합니다.');
  const signing = signingState(env);
  if (!unsigned && signing.kind !== 'complete') {
    console.error(`서명 정보가 준비되지 않아 release 빌드를 시작하지 않았습니다. 필요한 항목: ${signing.missing.join(', ')}`);
    console.error('개발용 unsigned 빌드만 확인하려면 --unsigned를 지정하세요. unsigned 결과의 종료코드는 2이며 제출용이 아닙니다.');
    return 2;
  }
  if (unsigned) for (const name of SIGNING_NAMES) delete env[name];
  else assertExternalKeystore(PROJECT_ROOT, env.SIGNAL_RELEASE_STORE_FILE);

  let destination = null;
  if (env.SIGNAL_RELEASE_TEAM || env.SIGNAL_RELEASE_OUT) {
    if (!env.SIGNAL_RELEASE_TEAM || !env.SIGNAL_RELEASE_OUT) throw new Error('SIGNAL_RELEASE_TEAM과 SIGNAL_RELEASE_OUT을 함께 지정하세요.');
    if (!/^[\p{L}\p{N} _.-]{1,80}$/u.test(env.SIGNAL_RELEASE_TEAM) || env.SIGNAL_RELEASE_TEAM.trim() !== env.SIGNAL_RELEASE_TEAM) throw new Error('팀명에 파일 경로·제어문자를 사용할 수 없습니다.');
    if (!unsigned && !testSignature) {
      destination = path.resolve(env.SIGNAL_RELEASE_OUT, `${env.SIGNAL_RELEASE_TEAM}_SIGNALDrive_release.apk`);
      if (existsSync(destination)) throw new Error('기존 제출 APK를 덮어쓰지 않습니다. 새 출력 폴더를 지정하세요.');
    }
  }
  const sourceBefore = collectSourceIdentity(PROJECT_ROOT, run);
  const gradle = tools.gradle && existsSync(tools.gradle) ? tools.gradle : path.join(PROJECT_ROOT, 'gradlew');
  const build = run(gradle, ['--no-daemon', '--console=plain', ':core:verifyCore', ':app:assembleRelease'], { cwd: PROJECT_ROOT, env, stdio: 'inherit' });
  if (build.status !== 0) return build.status || 1;
  const sourceAfter = collectSourceIdentity(PROJECT_ROOT, run);
  if (sourceBefore.manifestSha256 !== sourceAfter.manifestSha256) throw new Error('빌드 중 소스가 바뀌었습니다. 이 APK를 제출용으로 복사하지 않습니다.');
  const releaseDir = path.join(PROJECT_ROOT, 'app/build/outputs/apk/release');
  const outputMetadata = JSON.parse(readFileSync(path.join(releaseDir, 'output-metadata.json'), 'utf8'));
  if (outputMetadata.variantName !== 'release' || !Array.isArray(outputMetadata.elements) || outputMetadata.elements.length !== 1) throw new Error('release APK를 빌드 메타데이터에서 하나로 특정할 수 없습니다.');
  const element = outputMetadata.elements[0];
  if (typeof element.outputFile !== 'string' || path.basename(element.outputFile) !== element.outputFile || !element.outputFile.endsWith('.apk')) throw new Error('release 출력 메타데이터 경로가 유효하지 않습니다.');
  const apk = path.join(releaseDir, element.outputFile);
  const identity = {
    schemaVersion: 1, createdAt: new Date().toISOString(),
    releaseStatus: unsigned ? 'unsigned-not-submittable' : testSignature ? 'test-signed-not-submittable' : 'signed-release',
    apk: { name: path.basename(apk), sha256: sha256File(apk), bytes: statSync(apk).size, versionName: element.versionName, versionCode: element.versionCode, certificateSha256: null },
    source: sourceAfter, checks: { coreVerify: true, assembleRelease: true, signatureVerified: false },
  };
  if (!unsigned) {
    const signer = path.join(newestBuildTools(env.ANDROID_HOME), 'apksigner');
    const verify = run(signer, ['verify', '--print-certs', '--min-sdk-version', '28', apk], { env, encoding: 'utf8' });
    if (verify.status !== 0) throw new Error('APK 서명 검사에 실패했습니다. 제출용으로 복사하지 않습니다.');
    const certificate = parseCertificate(verify.stdout || '');
    if (!certificate.sha256 || certificate.isDebugCertificate) throw new Error('서명 인증서를 확인할 수 없거나 debug 인증서입니다.');
    identity.apk.certificateSha256 = certificate.sha256;
    identity.checks.signatureVerified = true;
    if (destination) exclusiveCopy(apk, destination);
  }
  if (identityPath) {
    mkdirSync(path.dirname(path.resolve(identityPath)), { recursive: true });
    writeFileSync(identityPath, JSON.stringify(identity, null, 2), { flag: 'wx' });
  }
  console.log(`Release status: ${identity.releaseStatus}`);
  console.log(`APK SHA-256: ${identity.apk.sha256}`);
  if (destination) console.log(`새 제출용 파일 생성: ${destination}`);
  if (unsigned || testSignature) { console.error('개발 검사용 결과이며 제출용이 아닙니다.'); return 2; }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runRelease(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
