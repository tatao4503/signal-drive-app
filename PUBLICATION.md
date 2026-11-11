# SIGNAL Drive 0.2.2 공개 버전

기록일:2026-11-11 KST. `kr.signal.drive`, versionName0.2.2, versionCode4입니다. 이번 버전의 코드·서명 APK·새 녹화 영상·검증 근거를 함께 제공합니다. GitHub 반영은 공모전 메일 접수나 주행 사용 승인을 뜻하지 않습니다.

- [release APK 다운로드](https://github.com/tatao4503/signal-drive-app/raw/refs/heads/main/apk/윤태웅_SIGNALDrive_release.apk)
- [시연 영상](demo/SIGNAL-Drive-v0.2.2-시연영상.mp4) — 90.37초,1920×1080,H.26430fps,음성 없음
- [이번 버전 검증](verification/v0.2.2/report.md) — Kotlin59 / Node59 / Android14 전화기42/42 / AAOS13 공회전 제한13/13
- [빌드·서명·소스](verification/v0.2.2/release-identity.json) · [APK 검사](verification/v0.2.2/apk-inspection.json) · [정지 화면 검토](verification/v0.2.2/visual-review.json) · [영상 검토](verification/v0.2.2/video-review.json)

APK SHA-256: `a044b6d47d43ede45d3810e5c3162b88dd238776ca431cead82d452b50e99d8a`

영상 SHA-256: `1a83b74566a6b3c9daebac9d0f692be403374c4b309ee3e6ff559cfc0e9fe14e`

## 이번 수정

녹색에서도 출발을 지시하지 않고 **현장 신호와 주변을 다시 확인**하도록 안내합니다. 새 안내의 가시 영역과 작은 가로 화면을 검사했습니다. 녹화·합성 도구는 프로젝트 버전/코드를 읽고 구버전 입력을 거부합니다. 새 영상은 같은0.2.2 APK로 다시 녹화했습니다. AAOS 정차·전환 중·공회전 제한·정차 복귀 자막은 명령·관측 기록과 실제 프레임을 대조합니다.

배포 목록은 이번 공개 파일 내용으로 다시 생성합니다. `release-identity.json`의64개 빌드 입력은 서명 당시 소스의 해시이고, `distribution-manifest.json`은 안내 문서·영상·버전별 근거를 포함한 공개 파일 목록입니다.

0.2.1과 같은 익명 release 키를 사용합니다. 키·비밀번호·신청서·연락처·소속·이메일은 공개하지 않습니다. APK 파일명에는 기존 개인 참가 제출 명칭을 유지합니다. 다른 키로 서명한 예전 설치본은 이 키의 APK로 업데이트할 수 없습니다.

## 검증 경계와 과거 기록

신호는 합성 시연 데이터이며 승인 매핑0건입니다. 실제 API·교차로 현장 정확도·지속 moving·Pleos SDK·실차(Pleos 에뮬레이터는 기어 P↔D 전환만 확인)·주행 사용 승인은 미검증입니다. AAOS 공회전(idling) 제한 전환을 지속 주행으로 표현하지 않습니다.

`verification/` 루트와0.2.1 영상은 이전 버전의 당시 기록입니다. 과거 통과 수를0.2.2의 결과로 옮겨 쓰지 않았습니다. 이전 공개본은 [0.2.1 커밋](https://github.com/tatao4503/signal-drive-app/tree/06bff815e401b0855d25239ba5d7ba8d453aa9ea)에서 확인할 수 있습니다.
