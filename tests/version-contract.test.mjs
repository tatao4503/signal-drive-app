import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseProjectVersion, assertInstalledVersion } from '../scripts/project-version.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const compose = path.join(root, 'scripts/compose-demo.py');
const fixture = (version, code) => [JSON.stringify({ version }), `android {\n versionName = "${version}"\n versionCode = ${code}\n}`];

test('recording follows a declared version bump and rejects a previous installed APK', () => {
  for (const [version, code] of [['0.2.2', 4], ['0.3.0', 5]]) {
    const expected = parseProjectVersion(...fixture(version, code));
    assert.doesNotThrow(() => assertInstalledVersion(expected, { versionName: version, versionCode: code }));
    assert.throws(() => assertInstalledVersion(expected, { versionName: '0.2.1', versionCode: 3 }), /설치본이 아닙니다/);
    assert.throws(() => assertInstalledVersion(expected, { versionName: version, versionCode: code - 1 }), /설치본이 아닙니다/);
  }
});

test('ambiguous or disagreeing project declarations cannot authorize recording', () => {
  const [pkg, gradle] = fixture('0.2.2', 4);
  assert.throws(() => parseProjectVersion(JSON.stringify({ version: '0.2.1' }), gradle), /같은 버전/);
  assert.throws(() => parseProjectVersion(pkg, `${gradle}\n versionCode = 5\n`), /같은 버전/);
  assert.throws(() => parseProjectVersion(pkg, gradle.replace('versionCode = 4', 'versionCode = projectCode')), /같은 버전/);
  assert.throws(() => parseProjectVersion(...fixture('0.2.2', 0)), /양의 정수/);
});

test('video composition rejects recordings from a different version or code before media access', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'signal-version-recording-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = `
import importlib.util, json, sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('signal_compose',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
directory=Path(sys.argv[2])
for version,code in [('previous-release',m.VERSION_CODE), (m.VERSION,m.VERSION_CODE+1)]:
 (directory/'recording-manifest.json').write_text(json.dumps({'completed':True,'platform':'phone','versionName':version,'versionCode':code}))
 try: m.load_recording(directory,'phone',m.PHONE_NAMES)
 except ValueError: pass
 else: raise AssertionError('incompatible recording was accepted')
print('incompatible recordings rejected')
`;
  const result = spawnSync('python3', ['-B', '-c', script, compose, directory], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('masked signing checks the selected output prefix before opening a password dialog', { skip: process.platform !== 'darwin' }, t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'signal-sign-output-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'output'); mkdirSync(output);
  writeFileSync(path.join(output, 'ReleaseFixture_SIGNALDrive_release.apk'), 'existing result must stay');
  const result = spawnSync('python3', ['-B', 'scripts/sign-release-macos.py', '--out', output,
    '--identity-json', path.join(directory, 'new-identity.json')], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, SIGNAL_RELEASE_TEAM: 'ReleaseFixture' },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Existing output is preserved/);
});
