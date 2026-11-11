"""Compose the current version's hero-first demo from verified emulator recordings."""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

_BASE_PATH = Path(__file__).with_name("compose-demo.py")
_SPEC = importlib.util.spec_from_file_location("signal_drive_compose_base", _BASE_PATH)
base = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(base)

# The recording clock precedes the first encoded frame. Buffer state labels around
# commands/observations rather than claiming an unmeasured frame-exact transition.
PRE_COMMAND_BUFFER = 0.5
POST_OBSERVATION_BUFFER = 0.25
AAOS_END_SECONDS = 22.9
PHONE_ORDER = [0, 8, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11]
PHONE_DURATIONS = {0: 6.0, 8: 6.5, 1: 5.0, 2: 4.0, 3: 3.5, 4: 3.5,
                   5: 3.5, 6: 3.5, 7: 3.5, 9: 4.0, 10: 4.0, 11: 4.5}
PHONE_CAPTIONS = {
    0: "합성 시연 신호를\n색과 남은 시간으로\n크게 보여줍니다",
    8: "모의 차량 입력의 주행 화면\n신호 · 남은 시간 · 현장 안내\n설정과 시연 입력은 잠급니다",
    1: "데이터가 늦으면\n색과 숫자를 숨기고\n이유를 보여줍니다",
    2: "새 시연 데이터가 오면\n다시 표시합니다",
    3: "연결 단절 시나리오\n색과 숫자를 숨깁니다",
    4: "다른 교차로 데이터는\n표시하지 않습니다",
    5: "진입 방향을 모르면\n표시하지 않습니다",
    6: "유효시간이 끝나면\n다음 색을 추측하지 않습니다",
    7: "새 시연 데이터로 복구되면\n다시 표시합니다",
    9: "기기 시계가 바뀌면\n표시를 보류합니다",
    10: "시계를 되돌려도\n지난 패킷을 다시 쓰지 않습니다",
    11: "새 시연 데이터가\n들어온 뒤에만 다시 표시합니다",
}


def finite_number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label}: 유한한 숫자가 필요합니다.")
    return float(value)


def aaos_transition_plan(manifest, end=AAOS_END_SECONDS):
    entries = manifest.get("aaosTransitions")
    states = ["parked-demo", "idling-restricted", "parked-live"]
    if (not isinstance(entries, list) or any(not isinstance(x, dict) for x in entries)
            or [x.get("state") for x in entries] != states):
        raise ValueError("AAOS 정차·공회전 제한·정차 복귀 관측 기록이 순서대로 필요합니다.")
    parked, idle, returned = entries
    first = finite_number(parked.get("seconds"), "정차 관측 시각")
    command = finite_number(idle.get("commandedAtSeconds"), "공회전 제한 명령 시각")
    observed = finite_number(idle.get("seconds"), "공회전 제한 관측 시각")
    return_command = finite_number(returned.get("commandedAtSeconds"), "정차 복귀 명령 시각")
    return_observed = finite_number(returned.get("seconds"), "정차 복귀 관측 시각")
    end = finite_number(end, "AAOS 클립 종료 시각")
    if not 0 <= first < command <= observed < return_command <= return_observed < end:
        raise ValueError("AAOS 명령·관측 시각이 서로 맞지 않거나 영상 범위를 벗어납니다.")
    intro_end = command - PRE_COMMAND_BUFFER
    idle_start = observed + POST_OBSERVATION_BUFFER
    return_start = return_command - PRE_COMMAND_BUFFER
    parked_start = return_observed + POST_OBSERVATION_BUFFER
    if not 1.5 <= intro_end < idle_start < return_start < parked_start < end:
        raise ValueError("상태 자막을 보수적으로 나눌 수 있는 AAOS 녹화 구간이 부족합니다.")
    return {
        "introEndSeconds": intro_end,
        "endSeconds": end,
        "preCommandBufferSeconds": PRE_COMMAND_BUFFER,
        "postObservationBufferSeconds": POST_OBSERVATION_BUFFER,
        "rawTimes": {"idlingCommand": command, "idlingObserved": observed,
                     "parkCommand": return_command, "parkObserved": return_observed},
        "captions": [
            (0.0, intro_end, "정차 중 합성 신호 시연\n실제 교통신호가 아닙니다"),
            (intro_end, idle_start, "AAOS 에뮬레이터 제한 상태 전환 구간\n합성 시연을 해제하고 설정을 잠급니다"),
            (idle_start, return_start, "AAOS 에뮬레이터 공회전(idling) 제한 상태\n시연 해제 · 설정 잠금 · 현재 신호 확인 불가"),
            (return_start, parked_start, "AAOS 에뮬레이터 정차 복귀 전환 구간\n실제 차량 주행 시험이 아닙니다"),
            (parked_start, end, "정차 복귀 · 시연으로 자동 복귀하지 않습니다\n지속 moving·Pleos·실차는 미검증입니다"),
        ],
    }


def clipped_captions(captions, start, end):
    return [(max(a, start) - start, min(b, end) - start, text)
            for a, b, text in captions if max(a, start) < min(b, end)]


def load_inputs(phone_dir, aaos_dir):
    phone = base.load_recording(phone_dir, "phone", base.PHONE_NAMES)
    aaos = base.load_recording(aaos_dir, "aaos", base.AAOS_NAMES)
    for field in ("apkSha256", "versionName", "versionCode", "sourceManifestSha256"):
        if phone[field] != aaos[field]:
            raise ValueError(f"phone/AAOS 녹화의 {field}가 일치하지 않습니다.")
    for manifest in (phone, aaos):
        restoration = manifest.get("restoration")
        if not isinstance(restoration, dict) or restoration.get("ok") is not True:
            raise ValueError("설정 원상복구가 완료된 녹화만 사용합니다.")
        if manifest.get("installedApkSha256") != manifest["apkSha256"]:
            raise ValueError("입력·설치 APK 해시가 일치하는 녹화만 사용합니다.")
    if phone["serial"] == aaos["serial"] or phone["avdName"] == aaos["avdName"]:
        raise ValueError("phone/AAOS는 서로 다른 전용 에뮬레이터 녹화여야 합니다.")
    clips = base.read_json(phone_dir / "phone-clips.json")
    if clips != phone["clips"]:
        raise ValueError("phone-clips.json이 검증된 녹화 manifest의 클립·시각 기록과 다릅니다.")
    for clip in clips:
        if finite_number(clip.get("lead"), f"{clip['file']} lead") < 0:
            raise ValueError("클립 시작 시각이 음수입니다.")
    return phone, aaos, clips, aaos_transition_plan(aaos)


class HeroComposition(base.Composition):
    def __init__(self, work_dir, font):
        super().__init__(work_dir, font)
        self.timeline = []
        self.duration = 0.0

    def remember(self, kind, duration, **fields):
        self.timeline.append({"kind": kind, "videoStartSeconds": self.duration,
                              "durationSeconds": duration, **fields})
        self.duration += duration

    def phone_scene(self, index, source, start, requested_duration):
        available = base.probe_duration(source) - start
        duration = min(requested_duration, available)
        if duration < 1.5:
            raise ValueError(f"{source}: 동작을 확인한 뒤의 실제 녹화가 부족합니다.")
        ordinal = self.input(source)
        filters = [f"[{ordinal}:v]trim=start={start}:duration={duration},setpts=PTS-STARTPTS,"
                   f"fps=30,scale=-2:1040,setsar=1,pad=1920:1080:240:20:color={base.BG}"]
        filters.append(self.text(f"hero-phone-{index}", PHONE_CAPTIONS[index], 54, 820,
                                 "(h-text_h)/2-60"))
        filters.append(self.text(
            f"hero-phone-{index}-note", f"일반 Android 에뮬레이터 · v{base.VERSION}\n"
            "모의 차량 입력 / 합성 신호 시연 (실제 신호 아님)",
            25, 820, 950, "0x9aa4ad"))
        self.append(filters)
        self.remember("phone", duration, file=source.name, sourceStartSeconds=start,
                      caption=PHONE_CAPTIONS[index])

    def aaos_scene(self, name, source, start, end, captions):
        self.aaos(name, source, start, end - start, captions)
        self.remember("aaos", end - start, file=source.name, sourceStartSeconds=start,
                      captions=[{"startSeconds": a, "endSeconds": b, "text": text}
                                for a, b, text in captions])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phone-dir", required=True, type=Path)
    parser.add_argument("--aaos-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--font-file", type=Path, default=base.DEFAULT_FONT)
    args = parser.parse_args(argv)
    phone_dir, aaos_dir = args.phone_dir.resolve(), args.aaos_dir.resolve()
    output = args.output.expanduser().absolute()
    sidecar = output.with_name(output.name + ".manifest.json")
    if os.path.lexists(output) or os.path.lexists(sidecar):
        parser.error("기존 영상·manifest는 덮어쓰지 않습니다. 새 출력 경로를 지정하세요.")
    if output.suffix.lower() != ".mp4":
        parser.error("출력 확장자는 .mp4여야 합니다.")
    if not args.font_file.is_file():
        parser.error("한글 자막 폰트를 찾을 수 없습니다.")
    if any(shutil.which(name) is None for name in ("ffmpeg", "ffprobe")):
        parser.error("ffmpeg와 ffprobe가 필요합니다.")
    try:
        phone, aaos, clips, plan = load_inputs(phone_dir, aaos_dir)
        aaos_source = aaos_dir / base.AAOS_NAMES[1]
        if base.probe_duration(aaos_source) <= plan["rawTimes"]["parkObserved"] + 0.25:
            raise ValueError("정차 복귀 관측 뒤의 실제 AAOS 녹화가 부족합니다.")
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="signal-drive-hero-") as directory:
            movie = HeroComposition(Path(directory), args.font_file.resolve())
            movie.card("hero-title", [
                ("SIGNAL Drive", 96, "white", 300),
                ("확인된 신호를, 크게, 한눈에", 56, "0x8fe3bf", 470),
                ("확인할 수 없으면 색과 숫자를 숨깁니다", 40, "0xc8d2d6", 570),
                (f"v{base.VERSION} · 합성 시연 · 실제 신호 미수신", 28, "0x9aa4ad", 760),
            ], 4.5)
            movie.remember("title", 4.5)
            movie.phone_scene(0, phone_dir / clips[0]["file"], clips[0]["lead"], PHONE_DURATIONS[0])
            split, end = plan["introEndSeconds"], plan["endSeconds"]
            movie.aaos_scene("hero-aaos-parked", aaos_source, 0, split,
                             clipped_captions(plan["captions"], 0, split))
            for index in PHONE_ORDER[1:]:
                clip = clips[index]
                movie.phone_scene(index, phone_dir / clip["file"], clip["lead"], PHONE_DURATIONS[index])
            movie.aaos_scene("hero-aaos-restrictions", aaos_source, split, end,
                             clipped_captions(plan["captions"], split, end))
            movie.aaos_scene("hero-aaos-live", aaos_dir / base.AAOS_NAMES[0], 1.0, 6.5, [(0, 5.5,
                "실시간 연결 상태 화면 · 실제 신호 미수신\n승인 매핑 0건이라 색과 숫자를 표시하지 않습니다")])
            movie.card("hero-end", [
                ("SIGNAL Drive", 52, "white", 290),
                ("합성 시연 데이터와 에뮬레이터로 동작을 보여줍니다", 36, "0x8fe3bf", 400),
                ("실제 신호 미수신 · 승인 매핑 0건 · 지속 moving 미검증\n"
                 "Pleos SDK·Pleos 에뮬레이터·실차 실행 및 주행 사용 승인 미검증\n"
                 "실제 신호등과 도로 상황을 우선 확인하세요", 28, "0x9aa4ad", 510),
                (f"v{base.VERSION} · APK SHA-256 {phone['apkSha256'][:16]}…", 25,
                 "0x8fe3bf", 760),
            ], 5.0)
            movie.remember("end", 5.0)
            graph = Path(directory) / "filter.txt"
            graph.write_text(movie.graph(), encoding="utf-8")
            subprocess.run(
                ["ffmpeg", "-hide_banner", "-v", "error", "-n", "-filter_threads", "2",
                 "-filter_complex_threads", "2"] + movie.inputs +
                ["-filter_complex_script", str(graph), "-map", "[out]", "-an",
                 "-c:v", "libx264", "-threads", "2", "-crf", "20", "-preset", "medium",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)], check=True)
        provenance = {
            "versionName": base.VERSION, "versionCode": phone["versionCode"],
            "apkSha256": phone["apkSha256"], "sourceManifestSha256": phone["sourceManifestSha256"],
            "videoSha256": base.sha256_file(output), "videoDurationSeconds": base.probe_duration(output),
            "edit": "hero-first; captions use buffered command/observation boundaries",
            "timeline": movie.timeline, "aaosTransitionPlan": plan,
            "staticTailExtensions": movie.static_extensions,
            "phoneRecording": phone, "aaosRecording": aaos,
            "inputClips": [{"platform": role, "file": name,
                            "sha256": base.sha256_file(directory / name)}
                           for role, directory, names in (("phone", phone_dir, base.PHONE_NAMES),
                                                          ("aaos", aaos_dir, base.AAOS_NAMES))
                           for name in names],
            "limits": ["synthetic signal demonstration", "no received live traffic signals",
                       "AAOS idling restrictions; sustained moving untested",
                       "Pleos and production vehicle untested; not a driving approval",
                       "transition timestamps are buffered metadata, not pixel detection"],
        }
        with sidecar.open("x", encoding="utf-8") as stream:
            json.dump(provenance, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        print(f"영상 생성: {output}\nSHA-256: {provenance['videoSha256']}\nManifest: {sidecar}")
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f"영상 합성 실패: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
