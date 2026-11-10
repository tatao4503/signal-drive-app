#!/bin/zsh
# 실명 없는 release 키를 새로 만든다(인증서 주체 = SIGNAL Drive).
# 공모전 조건: 첨부자료에 개발자 실명이 드러나지 않을 것. 기존 키는 지우지 않는다.
KEY="$HOME/Documents/SignalDrive-keys/signal-release-v2.jks"
[ -e "$KEY" ] && { echo "이미 있습니다: $KEY"; exit 1; }
JDK=$(python3 -c "import json;print(json.load(open('${0:A:h}/../../toolchains/paths.json'))['jdk'])")
echo "새 키 비밀번호를 정해 입력하세요(두 번). 화면에 안 보이는 게 정상입니다."
"$JDK/bin/keytool" -genkeypair -storetype PKCS12 -keystore "$KEY" -alias signal -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=SIGNAL Drive, OU=SIGNAL Drive, O=SIGNAL Drive, C=KR" && chmod 600 "$KEY" && echo "완료: $KEY"
