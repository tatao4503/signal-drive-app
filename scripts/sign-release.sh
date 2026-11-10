#!/bin/zsh
# 제출용 release 서명 빌드. 비밀번호는 화면에 표시하지 않고 이 셸 안에서만 쓰고 지운다.
# 키스토어 경로·팀명은 환경변수로 바꿀 수 있다.
cd "${0:A:h}/.." || exit 1
read -s "P?키 비밀번호 (입력해도 안 보이는 게 정상): " && echo
SIGNAL_RELEASE_STORE_FILE="${SIGNAL_RELEASE_STORE_FILE:-$HOME/Documents/SignalDrive-keys/signal-release.jks}" \
SIGNAL_RELEASE_STORE_PASSWORD="$P" SIGNAL_RELEASE_KEY_ALIAS="${SIGNAL_RELEASE_KEY_ALIAS:-signal}" SIGNAL_RELEASE_KEY_PASSWORD="$P" \
SIGNAL_RELEASE_TEAM="${SIGNAL_RELEASE_TEAM:-팀명}" SIGNAL_RELEASE_OUT="${SIGNAL_RELEASE_OUT:-./.local/release}" npm run android:release
unset P
