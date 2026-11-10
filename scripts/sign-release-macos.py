#!/usr/bin/env python3
"""Local masked macOS input. Never print, store, or pass passwords as arguments."""
import argparse
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
    apk = output / '메이드인시그널_SIGNALDrive_release.apk'
    if apk.exists() or identity.exists():
        parser.error('Existing output is preserved. Choose a new output location.')
    key = Path(os.environ.get('SIGNAL_RELEASE_STORE_FILE',
                             str(Path.home() / 'Documents/SignalDrive-keys/signal-release-v2.jks')))
    if not key.is_file() and not args.create_key:
        parser.error('Release keystore is unavailable. No build started.')
    if args.create_key and key.exists():
        parser.error('Key already exists. Refusing to replace it. Omit --create-key.')
    script = '''
set r to display dialog "SIGNAL Drive 0.2.1 제출 후보를 익명 release 키로 서명합니다.\n새 키 생성 시 비밀번호를 정해 주세요. 키는 기존 키와 별도로 보관합니다.\n취소하면 서명하지 않습니다." default answer "" with hidden answer buttons {"취소", "서명"} default button "서명" cancel button "취소" with title "SIGNAL Drive release 서명"
return text returned of r
'''
    result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
    if result.returncode != 0:
        print('로컬 입력이 취소되었거나 열리지 않아 서명하지 않았습니다.', file=sys.stderr)
        return 130
    password = result.stdout.removesuffix('\n')
    result = None
    if not password or (args.create_key and len(password) < 8):
        print('새 키에는 8자 이상 비밀번호가 필요합니다. 서명하지 않았습니다.', file=sys.stderr)
        return 2
    env = os.environ.copy()
    env.update(SIGNAL_RELEASE_STORE_FILE=str(key),
               SIGNAL_RELEASE_KEY_ALIAS=os.environ.get('SIGNAL_RELEASE_KEY_ALIAS', 'signal'),
               SIGNAL_RELEASE_STORE_PASSWORD=password, SIGNAL_RELEASE_KEY_PASSWORD=password,
               SIGNAL_RELEASE_TEAM='메이드인시그널', SIGNAL_RELEASE_OUT=str(output))
    password = None
    try:
        if args.create_key:
            confirm_script = 'set r to display dialog "새 키 비밀번호를 한 번 더 입력해 주세요." default answer "" with hidden answer buttons {"취소", "확인"} default button "확인" cancel button "취소" with title "SIGNAL Drive 새 키 확인"\nreturn text returned of r'
            confirmation = subprocess.run(['osascript', '-e', confirm_script], capture_output=True, text=True)
            if confirmation.returncode != 0 or confirmation.stdout.removesuffix('\n') != env['SIGNAL_RELEASE_STORE_PASSWORD']:
                print('확인 입력이 취소되었거나 일치하지 않아 키를 만들지 않았습니다.', file=sys.stderr)
                return 130
            confirmation = None
            import json
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
