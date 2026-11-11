# Pleos Connect Emulator 실행 확인 — SIGNAL Drive 0.2.2

확인일: 2026-11-11 KST · 수동 확인(에뮬레이터 + Pleos Connect Virtual Console). **Pleos 에뮬레이터 결과이며 실차·Pleos 앱 심사·주행 사용 승인이 아닙니다.**

## 환경

- Pleos Connect Emulator v2.1.0 (API 34, arm64, build `release_connect_v2.1.0`, user 빌드), Pleos 공식 SDK 저장소에서 받은 시스템 이미지(SHA-1 일치)
- 맥 M1(8GB), RAM 4GB, cold boot, 화면 2560×1440
- 설치 APK: release `0.2.2` / versionCode 4, SHA-256 `a044b6d47d43ede45d3810e5c3162b88dd238776ca431cead82d452b50e99d8a` (`apk/`와 동일)
- 차량 상태 변경: Pleos Connect Virtual Console(`adb forward tcp:8088 tcp:8088` → `http://127.0.0.1:8088/`)의 Gear Selection·Brake Pedal
- 앱은 Pleos SDK(Vehicle SDK 등)를 쓰지 않고, 표준 AAOS Car API(`CarUxRestrictionsManager`)로 제한 상태를 읽습니다.

## 결과

| 단계 | Pleos 상태 | SIGNAL Drive (앱 화면 기록 trace) | 결과 |
|---|---|---|---|
| 설치·실행 | 기어 P | 실시간 화면, `현재 신호 확인 불가`, "차량 플랫폼에서 제한 없음이 확인되었습니다 · flags 0" | 통과 |
| 정차 중 시연 | 기어 P | `시연 데이터 · 실제 신호 아님`, 녹색 21초, "현장 신호와 주위를 한 번 더 확인해요" | 통과 |
| 주행 기어 | 브레이크 100% + 기어 D (Pleos 화면도 D·주행 표시) | 시연 자동 해제(실시간), 색·초 없음, "지금은 신호등을 직접 봐 주세요", `주행 중 · 설정 잠금`, 시연·화면 전환 버튼 숨김, 앱이 맨 앞에 유지(차단 없음) | 통과 |
| 정차 복귀 | 기어 P | 일반 화면, "제한 없음", 시연으로 자동 복귀하지 않음 | 통과 |
| 비정상 종료 | — | crash 로그 0건 | 통과 |

캡처(앱 영역만): `01-app-app.png`, `07-parked-demo-app.png`, `08-driving-demo-off-app.png`, `09-parked-again-app.png`. Pleos 시스템 화면은 공개 저장소에 올리지 않았습니다.

## 관찰된 사항

- 첫 시도에서 브레이크 없이 Virtual Console로 기어 D를 보내자 **에뮬레이터의 차량 서비스(car service)가 재시작**됐습니다. 그 순간 앱은 `차량 상태 미확인 · 설정 잠금`(fail-closed)으로 바뀌었고, 시스템 UI 재시작으로 뒤로 밀린 앱을 다시 앞으로 가져오자 새 차량 서비스에 연결해 "제한 없음"을 다시 읽었습니다. 브레이크를 밟은 상태에서 기어를 바꾸면 재시작 없이 정상 반영됐습니다.
- 속도(가속)를 주는 지속 주행(moving) 시험은 하지 않았습니다. 이번 제한 전환은 기어 D·정지 상태 기준입니다.
- Pleos 멀티 윈도우의 앱 영역에서 글자가 작게 보입니다(2560×1440, mdpi). Pleos UI 디자인 가이드에 맞춘 크기 조정은 다음 과제입니다.

## 아직 아님

실제 신호 API 수신, 교차로 현장 정확도(승인 매핑 0건), 지속 moving 시험, Pleos SDK(Vehicle·NaviHelper·TextToSpeech·Gleo) 연동, 실차, Pleos App Market 심사·주행 사용 승인.
