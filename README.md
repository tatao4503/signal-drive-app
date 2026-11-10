# SIGNAL Drive v0.2

**확인된 신호만 보여주고, 확인할 수 없으면 아무것도 보여주지 않는 차량용 신호 표시 앱.**

한 교차로의 신호를 표시하기 전에 대상 방향과 원천 데이터 유효성을 확인하는 로컬 MVP입니다. 기존 보행자 Signal 원본에서 분리해 새로 만들었습니다.

## 왜 "아무것도 보여주지 않는 것"이 기능인가

운전자는 신호 앱의 숫자를 믿고 판단합니다. 몇 초 늦은 데이터, 다른 진입 방향의 신호, 시계가 틀어진 기기에서 계산한 카운트다운은 틀린 정보를 자신 있게 보여주는 것이고, 빈 화면보다 위험합니다.

그래서 SIGNAL Drive는 교차로·진입 방향·이동 종류·원천 시각·만료를 모두 확인한 신호만 표시합니다. 하나라도 확인되지 않으면 색과 초 숫자, 화면 읽기 문구까지 지우고 이유만 보여줍니다.

지금 버전에서 실제 신호가 나오지 않는 것도 같은 원칙 때문입니다. 현장에서 방향 매핑을 검증한 교차로가 아직 없고, API 키만 넣어 표시를 켜지 않습니다. 시연 모드는 같은 판정 규칙을 합성 데이터로 보여주며, 화면에 항상 `시연 데이터 · 실제 신호 아님`을 표시합니다.

주행 중에는 화면을 신호 원·남은 시간·이유 한 줄로 줄이고, 설정과 시연 입력을 잠급니다. 실제 차량에서 주행이 시작되면 **시연 데이터는 자동으로 꺼집니다.** "시연" 표시가 있어도 운전자가 가짜 신호를 진짜로 볼 수 있기 때문입니다. 주행 중에는 검증된 실제 신호만 보이며, 지금은 등록된 교차로가 없으므로 `현재 신호 확인 불가`가 표시됩니다.

## 제출 요약 (현대자동차그룹 차량용 앱 개발 공모전)

| 항목 | 내용 |
|---|---|
| 앱 이름 | SIGNAL Drive (`kr.signal.drive`, 0.2.0) |
| 한 줄 소개 | 확인된 신호만 보여주고, 확인할 수 없으면 아무것도 보여주지 않는 차량용 신호 표시 앱 |
| APK 위치 | 공모전 제출 메일에 첨부한 release APK. 이 저장소의 `apk/` 폴더에는 서명 키 교체 후 올립니다 |
| 테스트 환경 | Android 9(API 28) 이상. 일반 Android 14 에뮬레이터·Android Automotive 13 에뮬레이터에서 실행 확인(`검증결과.md`). 일반 Android는 시연 모드로 시작. Pleos SDK·Pleos 에뮬레이터·실차는 미검증 |
| 시연 영상 | [`demo/SIGNAL-Drive-v0.2-시연영상.mp4`](demo/) (97초, 에뮬레이터 화면 녹화 · Pleos·실차 아님) |
| 필요 설정 | 시연에는 설정·키가 필요 없음. 실제 신호는 승인 매핑과 소유 HTTPS 서버가 있어야 하며 기본 상태에서는 표시하지 않음 |

## APK 설치·실행

Android 9 이상 기기 또는 에뮬레이터에 설치합니다.

```sh
adb install <release APK 파일>.apk
```

앱 이름은 `SIGNAL Drive`입니다. 일반 Android에서는 시연 화면으로 시작하고, 설정·키 없이 바로 시연할 수 있습니다. Android Automotive에서는 주행 중에도 열려 있으며 주행 화면으로 바뀝니다. 시연 데이터는 정차 상태에서만 볼 수 있습니다.

## 웹 시연 실행

Mac에서는 `시작.command`를 실행합니다. 또는 Node.js 22 이상 환경에서 다음 명령을 사용합니다. 추가 패키지 설치는 필요하지 않습니다.

```sh
npm start
```

브라우저에서 `http://127.0.0.1:3217`을 엽니다. 터미널의 Ctrl+C로 종료합니다.

## 확인할 기능

1. 첫 화면의 `시연 데이터 · 실제 신호 아님` 표시를 확인합니다.
2. `시연 제어`를 펼쳐 정상·지연·시각 오류·매핑 불일치·단절·만료·방향 미확정·복구를 선택합니다.
3. 조건을 만족하지 않으면 신호 색과 초 숫자가 사라지고 이유가 표시됩니다.
4. `장애 흐름 재생`은 정상→지연→불일치→단절→복구를 자동 재현합니다.
5. 모의 차량을 주행 또는 미확인으로 바꾸면 데이터 설정이 잠깁니다. 모의 차량 선택은 시험 운영자용 입력이며 실제 차량 연동이 아닙니다.
6. `서버 데이터`는 승인 매핑이 없으므로 기본 상태에서 신호를 표시하지 않습니다.

## 구조

- `web/`: 가로·모바일 브라우저 화면과 시연 콘솔
- `server/`: 소유 서버에서만 서울 통합 API를 호출하는 중계·검증 로직
- `core/`: Android와 독립된 Kotlin TrustEngine, 차량 UX 정책, 시각 점프 감지
- `app/`: Kotlin 네이티브 Android 화면과 AAOS 제한 상태 어댑터
- `shared/`: 합성 수용 사례와 wire 계약
- `tests/`: 서버·브라우저 신호 규칙 테스트

## 실제 데이터 연결

`server/targets.json`과 Android `app/src/main/assets/approved-mappings.json`은 빈 배열입니다. API 키를 넣는 것만으로 실시간 신호가 표시되지 않습니다. 실제 교차로·접근 방향·movement와 현장 연결을 확인한 뒤 운영자가 매핑 버전과 검증 근거를 등록해야 합니다. 문서의 예시 교차로와 합성 테스트는 현장 검증 근거가 아닙니다.

키는 서버의 `TDATA_API_KEY` 환경변수만 사용합니다. 앱·브라우저·URL·소스에는 넣지 않습니다. 시연 실행에는 키가 필요하지 않습니다. 자세한 요청 제한과 설정은 `server/README.md`를 참고하세요.

데이터는 방향별 상태 필드를 명시적으로 읽으며 잔여시간으로 색을 추정하지 않습니다. 현재 실제 API 상태 해석은 `stop-And-Remain`(적색), `protected-Movement-Allowed`(녹색)만 지원합니다. 다른 상태는 확인 불가로 처리합니다. 3초 원천 신선도 제한은 개발용 보수적 설정이며 실차에서 검증된 안전 기준이 아닙니다.

## Android

Android Studio에서 이 폴더를 엽니다. JDK 17, Gradle 8.9, Android Gradle Plugin 8.7.3, Kotlin 2.0.21, SDK API 34 extension 12를 사용합니다. 최소 실행 버전은 Android 9(API 28)입니다.

```sh
npm run android:check
```

일반 Android에서는 명시적 시연 모드로 시작합니다. Automotive에서는 실제 차량 제한 상태가 확인되기 전까지 설정·시연을 잠그고 실시간 상태 화면으로 시작합니다. AAOS 어댑터는 공개 `CarUxRestrictionsManager`의 lifecycle/리스너를 사용합니다. Android Automotive OS 에뮬레이터(API 33)에서 실제 제한 상태를 읽는 것을 확인했습니다. Pleos SDK·Pleos 에뮬레이터·실차에서는 실행 검증하지 않았습니다.

APK에는 API 키나 승인 매핑을 포함하지 않습니다. 기본 화면은 합성 신호이며 실제 차량 위치를 읽지 않습니다. 소유한 HTTPS 서버를 사용할 때만 Gradle 속성 `signalBackendUrl`을 설정합니다. HTTPS 주소 외의 임의 중계나 공개 CORS 프록시는 지원하지 않습니다.

manifest에서 화면을 주행 중 사용 가능(`distractionOptimized`)으로 선언했습니다. 차량 제한 상태가 정차가 아니면(주행·미확인) 앱이 스스로 주행 화면으로 줄이고 시연·설정 입력을 잠그며, 시연 데이터를 끕니다. AAOS 에뮬레이터에서 주행 상태에도 앱이 차단되지 않고 주행 화면으로 바뀌는 것을 확인했습니다. **Pleos·실차의 주행 허용 심사는 받지 않았습니다.** 앱 카테고리·주행 허용 검토와 실제 플랫폼 제한 시험은 다음 단계입니다. `npm run android:check`의 APK는 로컬 개발용 debug 빌드입니다. 제출용은 아래 release 빌드를 사용합니다.

## 제출용 release 빌드

debug APK의 이름만 바꾼 것은 release가 아닙니다. `:app:assembleRelease`로 빌드하고 서명을 검사한 결과만 제출합니다.

서명 정보는 환경변수로만 넘깁니다. 키스토어는 작업본 밖에 두고, 비밀번호를 파일에 적지 않습니다.

Mac에서는 `scripts/sign-release.sh`를 실행하면 비밀번호를 화면에 표시하지 않고 한 번 입력받아 빌드합니다(기본 키스토어 `~/Documents/SignalDrive-keys/signal-release.jks`, 별칭 `signal`). 직접 지정하려면:

```sh
export SIGNAL_RELEASE_STORE_FILE=/작업본/밖/signal-release.jks
export SIGNAL_RELEASE_KEY_ALIAS=signal
read -s SIGNAL_RELEASE_STORE_PASSWORD; export SIGNAL_RELEASE_STORE_PASSWORD
read -s SIGNAL_RELEASE_KEY_PASSWORD; export SIGNAL_RELEASE_KEY_PASSWORD
SIGNAL_RELEASE_TEAM=팀명 SIGNAL_RELEASE_OUT=./apk npm run android:release
```

키가 없으면 서명 없는 release가 만들어지고 "제출용이 아님"으로 표시됩니다. 키스토어가 작업본 안에 있거나 debug 인증서로 서명된 경우에는 실패합니다. release 키를 잃어버리면 같은 앱으로 업데이트할 수 없으므로 키스토어와 비밀번호는 별도로 백업합니다.

## 검증

```sh
npm test
npm run android:check
```

코어 테스트는 `:core:verifyCore`로 실행합니다. 검증 결과는 함께 제공되는 `검증결과.md`에 기록합니다.

### 기기·에뮬레이터 실행 검증

```sh
node scripts/android-device-check.mjs <apk> <결과폴더> [--serial emulator-5554] [--clock]
```

연결된 기기에 APK를 설치하고 시연 화면을 실제로 조작해 표시·보류·복구·잠금·백그라운드 복귀·화면 크기 변경·스크롤을 확인합니다. `--clock`은 root가 되는 에뮬레이터에서 시계를 1시간 뒤로 돌렸다 되돌려 과거 패킷이 다시 나타나지 않는지 봅니다. 단계별 스크린샷과 `results.json`을 남깁니다.

남은 초가 1초마다 바뀌는 동안에는 UI Automator가 화면을 읽지 못하므로, 스크립트는 앱의 검증용 화면 기록을 읽습니다. 이 기록은 `adb shell setprop log.tag.SignalDriveUi DEBUG`로 켤 때만 남고(스크립트가 켬), 화면에 보이는 문구·초·접근성 설명·버튼 위치만 담습니다.

이번 범위는 표시·보류·복구의 개발 검증입니다. 실제 신호 정확도, 실차 안전, 사고 감소, 전국 실시간 서비스, Pleos 심사·입점 결과를 주장하지 않습니다.
