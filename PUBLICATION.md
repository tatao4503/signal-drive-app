# SIGNAL Drive 0.2.1 공개 묶음

기록일: 2026-11-10 KST. 이 버전의 개발 코드, 서명 APK, 시연 영상과 실행 근거를 함께 제공합니다. 공모전의 메일 접수 상태나 주행 사용 승인을 뜻하지 않습니다.

- [release APK 다운로드](https://github.com/tatao4503/signal-drive-app/raw/refs/heads/main/apk/메이드인시그널_SIGNALDrive_release.apk)
- [시연 영상](demo/SIGNAL-Drive-v0.2.1-시연영상.mp4) — 101.17초, 1920×1080 H.264 30fps, 음성 없음
- [최종 검증 기록](verification/report.md) — Kotlin59, Node55, Android14 전화기40/40, AAOS13 공회전 제한12/12
- [빌드 소스·서명 근거](verification/release-identity.json), [APK 검사](verification/apk-inspection.json), [별도 화면 검토](verification/visual-review.json)

APK: `kr.signal.drive`, versionName `0.2.1`, versionCode `3`. APK SHA-256: `52174cf9ee1ae136feb20f36533a4f20e1812fa5597670c7dbf76cc1a66edda7`.

빌드 당시 소스 61개 파일은 검증한 내용과 동일합니다. 이 공개 반영에서 추가한 `PUBLICATION.md`와 `apk/README.md`는 안내 문서입니다. 서명 키·비밀번호·접수양식·개인정보는 이 공개 묶음에 포함하지 않습니다. 새 익명 release 키를 사용하므로 이전 키로 서명된 앱 위에는 업데이트할 수 없습니다.

## 기록을 읽는 방법

`verification/report.md`와 `verification/검증결과.md`의 "업로드하지 않음"은 APK 빌드·로컬 검증 당시의 기록입니다. 현재 공개 버전의 위치와 파일 식별 정보는 이 문서를 기준으로 확인하세요. 이전 v0.2 영상은 이전 버전의 기록이며 현재 실행 근거로 사용하지 않습니다.

README의 API 키 "URL 비노출"은 공유 URL을 뜻합니다. 키는 서버 환경변수로 관리하고 앱·브라우저·공유 URL·응답·로그에 노출하지 않습니다. 원천 API가 요구하는 인증 요청은 서버에서만 수행합니다.

## 검증 경계

화면의 신호는 합성 시연 데이터입니다. 승인 매핑0건이며 실제 신호 API 수신·교차로 현장 정확도는 미검증입니다. AAOS 공회전(idling)의 제한 전환 확인은 지속 moving 시험이 아닙니다. Pleos SDK·Pleos 에뮬레이터·실차에서 검증하지 않았으며 DO 선언도 주행 사용 승인이나 안전 성능의 증명이 아닙니다.
