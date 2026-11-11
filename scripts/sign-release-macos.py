#!/usr/bin/env python3
"""Local masked macOS input. Never print, store, or pass passwords as arguments."""
import argparse
import json
import re
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--create-key', action='store_true', help='Create a new anonymous key if absent')
    parser.add_argument('--out', required=True, help='New APK output folder')
    parser.add_argument('--identity-json', required=True, help='New build identity file')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    if sys.platform != 'darwin':
        parser.error('This helper requires macOS. Use sign-release.sh in a local terminal.')
    output = Path(args.out).resolve()
    identity = Path(args.identity_json).resolve()
    version = json.loads((root / 'package.json').read_text(encoding='utf-8')).get('version')
    if not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?', version):
        parser.error('A valid project version is required before local input.')
    gradle = (root / 'app/build.gradle.kts').read_text(encoding='utf-8')
    names = re.findall(r'^\s*versionName\s*=\s*"([^"]+)"\s*(?://[^\n]*)?$', gradle, re.MULTILINE)
    codes = re.findall(r'^\s*versionCode\s*=\s*(\d+)\s*(?://[^\n]*)?$', gradle, re.MULTILINE)
    if len(names) != 1 or len(codes) != 1 or names[0] != version or not 0 < int(codes[0]) <= 9_007_199_254_740_991:
        parser.error('Package and Android version declarations must agree before local input.')
    team = os.environ.get('SIGNAL_RELEASE_TEAM', '메이드인시그널')
    if not 1 <= len(team) <= 80 or team.strip() != team or not all(c.isalnum() or c in ' _.-' for c in team):
        parser.error('SIGNAL_RELEASE_TEAM must be a safe file prefix.')
    apk = output / f'{team}_SIGNALDrive_release.apk'
    if apk.exists() or identity.exists():
        parser.error('Existing output is preserved. Choose a new output location.')
    key = Path(os.environ.get('SIGNAL_RELEASE_STORE_FILE',
                             str(Path.home() / 'Documents/SignalDrive-keys/signal-release-v2.jks')))
    if not key.is_file() and not args.create_key:
        parser.error('Release keystore is unavailable. No build started.')
    if args.create_key and key.exists():
        parser.error('Key already exists. Refusing to replace it. Omit --create-key.')
    key_action = '새 익명 키의 비밀번호를 정해 주세요. 기존 키는 보존합니다.' if args.create_key else '기존 익명 release 키의 비밀번호를 입력해 주세요. 새 키를 만들지 않습니다.'
    prompt = f'SIGNAL Drive {version} 제출 후보를 익명 release 키로 서명합니다.\n{key_action}\n취소하면 서명하지 않습니다.'
    script = ('set r to display dialog ' + json.dumps(prompt, ensure_ascii=False)
              + ' default answer "" with hidden answer buttons {"취소", "서명"} default button "서명" cancel button "취소" with title "SIGNAL Drive release 서명"\nreturn text returned of r')
    result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
    if result.returncode != 0:
        print('로컬 입력이 취소되었거나 열리지 않아 서명하지 않았습니다.', file=sys.stderr)
        return 130
    password = result.stdout.removesuffix('\n')
    result = None
    if not password or (args.create_key and len(password) < 8):
        print('비밀번호가 비어 있거나 새 키의 8자 이상 조건을 만족하지 않아 서명하지 않았습니다.', file=sys.stderr)
        return 2
    env = os.environ.copy()
    env.update(SIGNAL_RELEASE_STORE_FILE=str(key),
               SIGNAL_RELEASE_KEY_ALIAS=os.environ.get('SIGNAL_RELEASE_KEY_ALIAS', 'signal'),
               SIGNAL_RELEASE_STORE_PASSWORD=password, SIGNAL_RELEASE_KEY_PASSWORD=password,
               SIGNAL_RELEASE_TEAM=team, SIGNAL_RELEASE_OUT=str(output))
    password = None
    try:
        if args.create_key:
            confirm_script = 'set r to display dialog "새 키 비밀번호를 한 번 더 입력해 주세요." default answer "" with hidden answer buttons {"취소", "확인"} default button "확인" cancel button "취소" with title "SIGNAL Drive 새 키 확인"\nreturn text returned of r'
            confirmation = subprocess.run(['osascript', '-e', confirm_script], capture_output=True, text=True)
            if confirmation.returncode != 0 or confirmation.stdout.removesuffix('\n') != env['SIGNAL_RELEASE_STORE_PASSWORD']:
                print('확인 입력이 취소되었거나 일치하지 않아 키를 만들지 않았습니다.', file=sys.stderr)
                return 130
            confirmation = None
            tools = json.loads((root.parent / 'toolchains/paths.json').read_text())
            key.parent.mkdir(parents=True, exist_ok=True)
            created = subprocess.run([str(Path(tools['jdk']) / 'bin/keytool'), '-genkeypair',
                '-storetype', 'PKCS12', '-keystore', str(key), '-alias', env['SIGNAL_RELEASE_KEY_ALIAS'],
                '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000',
                '-dname', 'CN=SIGNAL Drive, OU=SIGNAL Drive, O=SIGNAL Drive, C=KR',
                '-storepass:env', 'SIGNAL_RELEASE_STORE_PASSWORD',
                '-keypass:env', 'SIGNAL_RELEASE_KEY_PASSWORD'], env=env,
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            if created.returncode != 0:
                print('새 키 생성에 실패했습니다. 기존 키는 보존했습니다.', file=sys.stderr)
                return 1
            key.chmod(0o600)
            print('새 익명 release 키 생성 완료. 기존 키는 보존했습니다.')
        return subprocess.run(['node', 'scripts/build-release.mjs', '--identity-json', str(identity)],
                              cwd=root, env=env).returncode
    finally:
        for name in ['SIGNAL_RELEASE_STORE_PASSWORD', 'SIGNAL_RELEASE_KEY_PASSWORD']:
            env.pop(name, None)


if __name__ == '__main__':
    sys.exit(main())
