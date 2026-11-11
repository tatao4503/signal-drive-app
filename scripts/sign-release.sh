#!/bin/zsh
# 비밀번호는 이 프로세스 안에서만 사용한다. 자동 실행은 build-release.mjs에 환경변수로 전달한다.
emulate -L zsh
unsetopt XTRACE VERBOSE
cd "${0:A:h}/.." || exit 1

if [[ ! -t 0 || ! -t 1 ]]; then
  print -u2 -- '비밀번호 입력은 터미널에서만 가능합니다. 입력 취소 또는 비대화형 실행으로 빌드하지 않았습니다.'
  exit 2
fi

typeset task_signing_password=''
trap 'unset task_signing_password' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if ! read -rs 'task_signing_password?키 비밀번호 (입력해도 표시되지 않습니다): '; then
  print -u2 -- '\n입력을 취소했습니다. 빌드하지 않았습니다.'
  exit 130
fi
print
if [[ -z "$task_signing_password" ]]; then
  print -u2 -- '빈 비밀번호로 빌드하지 않았습니다.'
  exit 2
fi

SIGNAL_RELEASE_STORE_FILE="${SIGNAL_RELEASE_STORE_FILE:-$HOME/Documents/SignalDrive-keys/signal-release-v2.jks}" \
SIGNAL_RELEASE_STORE_PASSWORD="$task_signing_password" SIGNAL_RELEASE_KEY_ALIAS="${SIGNAL_RELEASE_KEY_ALIAS:-signal}" SIGNAL_RELEASE_KEY_PASSWORD="$task_signing_password" \
SIGNAL_RELEASE_TEAM="${SIGNAL_RELEASE_TEAM:-메이드인시그널}" SIGNAL_RELEASE_OUT="${SIGNAL_RELEASE_OUT:-./.local/release-candidate}" npm run android:release
typeset -i task_build_status=$?
unset task_signing_password
exit $task_build_status
