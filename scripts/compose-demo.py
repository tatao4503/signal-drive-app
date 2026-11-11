"""Compose a labeled project-version video from matching phone and AAOS recordings."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def read_project_version(root):
    package_version = json.loads((root / "package.json").read_text(encoding="utf-8")).get("version")
    gradle = (root / "app/build.gradle.kts").read_text(encoding="utf-8")
    names = re.findall(r'^\s*versionName\s*=\s*"([^"]+)"\s*(?://[^\n]*)?$', gradle, re.MULTILINE)
    codes = re.findall(r'^\s*versionCode\s*=\s*(\d+)\s*(?://[^\n]*)?$', gradle, re.MULTILINE)
    if (not isinstance(package_version, str)
            or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", package_version)
            or len(names) != 1 or len(codes) != 1 or names[0] != package_version):
        raise ValueError("package.json과 Android의 versionName을 하나의 같은 버전으로 맞춰야 합니다.")
    code = int(codes[0])
    if not 0 < code <= 9_007_199_254_740_991:
        raise ValueError("Android versionCode가 올바른 양의 정수가 아닙니다.")
    return {"versionName": package_version, "versionCode": code}


PROJECT_VERSION = read_project_version(Path(__file__).resolve().parent.parent)
VERSION = PROJECT_VERSION["versionName"]
VERSION_CODE = PROJECT_VERSION["versionCode"]
BG = "0x0f1419"
DEFAULT_FONT = Path("/System/Library/Fonts/AppleSDGothicNeo.ttc")
PHONE_NAMES = [
    "clip-01-green.mp4", "clip-02-delay.mp4", "clip-03-recover.mp4",
    "clip-04-disconnect.mp4", "clip-05-mismatch.mp4", "clip-06-direction.mp4",
    "clip-07-expired.mp4", "clip-08-recover.mp4", "clip-09-driving.mp4",
    "clip-10-clock-back.mp4", "clip-11-clock-restore.mp4", "clip-12-new-data.mp4",
]
AAOS_NAMES = ["aaos-1-live.mp4", "aaos-2-drive.mp4"]
PHONE_CAPTIONS = [
    "합성 시연 데이터\n조건이 맞을 때 색과\n남은 시간을 보여줍니다",
    "데이터가 늦게 오면\n색과 숫자를 숨기고\n이유를 보여줍니다",
    "새 시연 데이터가 오면\n다시 표시합니다",
    "연결 단절 시나리오\n색과 숫자를 숨깁니다",
    "교차로가 다른 데이터는\n표시하지 않습니다",
    "진입 방향을 모르면\n표시하지 않습니다",
    "유효시간이 끝나면\n다음 색을 추측하지 않습니다",
    "새 시연 데이터가 오면\n다시 표시합니다",
    "모의 차량 입력으로 보는\n주행 화면 미리보기\n실제 차량 주행 시험이 아닙니다",
    "기기 시계가 바뀌면\n표시를 보류합니다",
    "시계를 되돌려도\n지난 패킷을 다시 쓰지 않습니다",
    "새 시연 데이터가\n들어온 뒤에만 다시 표시합니다",
]


def read_json(path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_hash(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError(f"{label}: SHA-256가 없거나 올바르지 않습니다.")
    return value


def manifest_clip_names(manifest):
    clips = manifest.get("clips")
    if not isinstance(clips, list):
        raise ValueError("녹화 manifest의 clips 목록이 없습니다.")
    return [clip.get("file") if isinstance(clip, dict) else clip for clip in clips]


def load_recording(directory, platform, expected_names):
    manifest_path = directory / "recording-manifest.json"
    manifest = read_json(manifest_path)
    if not isinstance(manifest, dict) or manifest.get("completed") is not True:
        raise ValueError(f"{manifest_path}: completed=true인 녹화가 필요합니다.")
    if manifest.get("platform") != platform or manifest.get("versionName") != VERSION:
        raise ValueError(f"{manifest_path}: {platform} / 버전 {VERSION} 녹화가 아닙니다.")
    if type(manifest.get("versionCode")) is not int or manifest["versionCode"] != VERSION_CODE:
        raise ValueError(f"{manifest_path}: 프로젝트의 versionCode {VERSION_CODE} 녹화가 필요합니다.")
    require_hash(manifest.get("apkSha256"), f"{manifest_path} apkSha256")
    source_hash = require_hash(
        manifest.get("sourceManifestSha256"), f"{manifest_path} sourceManifestSha256"
    )
    source_name = manifest.get("sourceManifestFile")
    if not isinstance(source_name, str) or Path(source_name).name != source_name:
        raise ValueError(f"{manifest_path}: sourceManifestFile은 같은 폴더의 파일명이어야 합니다.")
    source_path = directory / source_name
    if not source_path.is_file() or sha256_file(source_path) != source_hash:
        raise ValueError(f"{manifest_path}: 보관한 소스 manifest의 해시가 맞지 않습니다.")
    if not isinstance(manifest.get("serial"), str) or not manifest["serial"].startswith("emulator-"):
        raise ValueError(f"{manifest_path}: 녹화한 에뮬레이터 serial이 필요합니다.")
    if not isinstance(manifest.get("avdName"), str) or not manifest["avdName"].strip():
        raise ValueError(f"{manifest_path}: 녹화한 AVD 이름이 필요합니다.")
    if manifest_clip_names(manifest) != expected_names:
        raise ValueError(f"{manifest_path}: 필수 녹화 클립과 순서가 맞지 않습니다.")
    for clip, name in zip(manifest["clips"], expected_names):
        clip_path = directory / name
        if not clip_path.is_file() or clip_path.stat().st_size == 0:
            raise ValueError(f"녹화 클립이 없거나 비어 있습니다: {clip_path}")
        if not isinstance(clip, dict) or clip.get("sha256") != sha256_file(clip_path):
            raise ValueError(f"녹화 후 클립 해시가 변경됐습니다: {clip_path}")
    return manifest


def probe_duration(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True, timeout=30,
    )
    seconds = float(result.stdout.strip())
    if not 0 < seconds < 600:
        raise ValueError(f"녹화 길이가 올바르지 않습니다: {path}")
    return seconds


def filter_path(path):
    # Escaping is for the FFmpeg filter grammar; no shell command is used.
    value = str(path)
    if "\n" in value or "\r" in value:
        raise ValueError("경로에 줄바꿈을 사용할 수 없습니다.")
    return "'" + value.replace("\\", "\\\\").replace("'", "'\\''").replace(":", "\\:") + "'"


class Composition:
    def __init__(self, work_dir, font):
        self.work_dir = work_dir
        self.font = font
        self.inputs = []
        self.parts = []
        self.count = 0
        self.static_extensions = []

    def text(self, name, text, size, x, y, color="white", extra=""):
        caption = self.work_dir / f"{name}.txt"
        caption.write_text(text, encoding="utf-8")
        return (f"drawtext=fontfile={filter_path(self.font)}:textfile={filter_path(caption)}"
                f":fontsize={size}:fontcolor={color}:x={x}:y={y}"
                f":line_spacing={int(size * 0.45)}{extra}")

    def append(self, filters):
        self.parts.append(",".join(filters) + f",format=yuv420p[s{self.count}]")
        self.count += 1

    def card(self, name, lines, duration):
        filters = [f"color=c={BG}:s=1920x1080:d={duration}:r=30"]
        filters.extend(self.text(f"{name}-{index}", text, size, "(w-text_w)/2", y, color)
                       for index, (text, size, color, y) in enumerate(lines))
        self.append(filters)

    def input(self, path):
        self.inputs.extend(["-threads", "1", "-i", str(path)])
        return len(self.inputs) // 4 - 1

    def aaos(self, name, source, start, duration, captions):
        available = probe_duration(source) - start
        if available <= 0:
            raise ValueError(f"{source}: 표시할 녹화 구간이 없습니다.")
        if available < duration:
            self.static_extensions.append({"file": source.name, "seconds": duration - available})
        index = self.input(source)
        filters = [f"[{index}:v]trim=start={start}:duration={duration},setpts=PTS-STARTPTS,"
                   f"fps=30,tpad=stop_mode=clone:stop_duration={max(0, duration-available)},trim=duration={duration},scale=1104:828,setsar=1,pad=1920:1080:408:14:color={BG}"]
        for ordinal, (first, last, caption) in enumerate(captions):
            filters.append(self.text(f"{name}-{ordinal}", caption, 34, "(w-text_w)/2", 866,
                                     extra=f":enable='gte(t,{first})*lt(t,{last})'"))
        filters.append(self.text(
            f"{name}-note", f"AAOS 13 에뮬레이터 · v{VERSION} · Pleos·실차 아님\n"
            "공회전 제한 시험 · 지속 moving 미검증 · 정지 구간 일부는 설명을 위해 연장",
            22, "(w-text_w)/2", 1000, "0x9aa4ad"))
        self.append(filters)

    def phone(self, index, source, start, duration):
        input_index = self.input(source)
        filters = [f"[{input_index}:v]trim=start={start}:duration={duration},setpts=PTS-STARTPTS,"
                   f"fps=30,scale=-2:1040,setsar=1,pad=1920:1080:240:20:color={BG}"]
        filters.append(self.text(f"phone-{index}", PHONE_CAPTIONS[index], 54, 820,
                                 "(h-text_h)/2-60"))
        filters.append(self.text(
            f"phone-{index}-note", f"일반 Android 14 에뮬레이터 · v{VERSION}\n"
            "모의 차량 입력 / 합성 신호 시연 (실제 신호 아님)",
            25, 820, 950, "0x9aa4ad"))
        self.append(filters)

    def graph(self):
        joined = "".join(f"[s{index}]" for index in range(self.count))
        return ";".join(self.parts) + f";{joined}concat=n={self.count}:v=1:a=0[out]"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phone-dir", required=True, type=Path)
    parser.add_argument("--aaos-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--font-file", type=Path, default=DEFAULT_FONT)
    args = parser.parse_args()
    phone_dir, aaos_dir = args.phone_dir.resolve(), args.aaos_dir.resolve()
    output = args.output.expanduser().absolute()
    sidecar = output.with_name(output.name + ".manifest.json")
    if os.path.lexists(output) or os.path.lexists(sidecar):
        parser.error("출력 파일 또는 영상 manifest가 이미 있습니다. 다른 출력 경로를 사용하세요.")
    if output.suffix.lower() != ".mp4":
        parser.error("출력 확장자는 .mp4여야 합니다.")
    if not args.font_file.is_file():
        parser.error(f"한글 자막 폰트를 찾을 수 없습니다: {args.font_file}")
    for command in ("ffmpeg", "ffprobe"):
        if shutil.which(command) is None:
            parser.error(f"{command}가 필요합니다.")

    try:
        phone = load_recording(phone_dir, "phone", PHONE_NAMES)
        aaos = load_recording(aaos_dir, "aaos", AAOS_NAMES)
        for field in ("apkSha256", "versionName", "versionCode", "sourceManifestSha256"):
            if phone[field] != aaos[field]:
                raise ValueError(f"phone/AAOS 녹화의 {field}가 일치하지 않습니다.")
        if phone["serial"] == aaos["serial"] or phone["avdName"] == aaos["avdName"]:
            raise ValueError("phone/AAOS는 서로 다른 격리 에뮬레이터 녹화여야 합니다.")
        clips = read_json(phone_dir / "phone-clips.json")
        if not isinstance(clips, list) or [clip.get("file") for clip in clips] != PHONE_NAMES:
            raise ValueError("phone-clips.json은 정해진 12개 클립을 순서대로 포함해야 합니다.")

        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="signal-drive-compose-") as directory:
            work_dir = Path(directory)
            movie = Composition(work_dir, args.font_file.resolve())
            movie.card("title", [
                ("SIGNAL Drive", 96, "white", 310),
                ("확인할 수 없으면 색과 숫자를 숨깁니다", 48, "0x8fe3bf", 490),
                (f"v{VERSION} · 에뮬레이터 시연 · 실제 신호 미수신", 31, "0x9aa4ad", 660),
                ("현대자동차그룹 차량용 앱 개발 공모전", 28, "0x9aa4ad", 760),
            ], 4.5)
            movie.aaos("aaos-live", aaos_dir / AAOS_NAMES[0], 0.3, 5.7, [(0, 5.7,
                "실시간 연결 상태 화면 · 실제 신호는 수신하지 않았습니다\n"
                "승인 매핑 0건이므로 색과 숫자를 표시하지 않습니다")])
            for index, clip in enumerate(clips):
                source = phone_dir / clip["file"]
                start = float(clip.get("lead", 0))
                available = probe_duration(source) - start
                duration = min(6.0 if index == 8 else 5.0, available)
                if start < 0 or duration < 1.5:
                    raise ValueError(f"{source}: 동작 이후 실제 녹화 구간이 부족합니다.")
                movie.phone(index, source, start, duration)
            transitions = {entry["state"]: entry for entry in aaos["aaosTransitions"]}
            restricted = float(transitions["idling-restricted"]["seconds"])
            parked = float(transitions["parked-live"]["seconds"])
            if not 0 < restricted < parked < 23:
                raise ValueError("AAOS 상태 전환 시각이 녹화 구간과 맞지 않습니다.")
            movie.aaos("aaos-idling", aaos_dir / AAOS_NAMES[1], 0, 23, [
                (0, restricted, "정차 → 공회전 제한 전환 · 합성 신호 시연\n실제 교통신호가 아닙니다"),
                (restricted, parked, "기어 D·브레이크 해제의 공회전(idling) 제한 상태\n"
                 "시연 해제·설정 잠금 확인 · 현재 신호 확인 불가"),
                (parked, 23, "정차 복귀 · 시연으로 자동 복귀하지 않습니다\n"
                 "지속 moving 상태·Pleos·실차 주행은 미검증입니다"),
            ])
            movie.card("end", [
                ("이 영상은 합성 신호와 에뮬레이터를 사용한 시연입니다", 42, "white", 330),
                ("실제 신호 미수신 · 승인 매핑 0건 · 지속 moving 상태 미검증\n"
                 "DO 선언은 주행 사용 승인이나 안전성 검증이 아닙니다\n"
                 "Pleos SDK·Pleos 에뮬레이터·실차에서 검증하지 않았습니다", 32, "0x9aa4ad", 450),
                (f"SIGNAL Drive v{VERSION} · APK SHA-256 {phone['apkSha256'][:16]}…",
                 27, "0x8fe3bf", 720),
            ], 6)
            graph_path = work_dir / "filter.txt"
            graph_path.write_text(movie.graph(), encoding="utf-8")
            subprocess.run(
                ["ffmpeg", "-hide_banner", "-v", "error", "-n", "-filter_threads", "2",
                 "-filter_complex_threads", "2"] + movie.inputs +
                ["-filter_complex_script", str(graph_path), "-map", "[out]", "-an",
                 "-c:v", "libx264", "-threads", "2", "-crf", "20", "-preset", "medium",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)],
                check=True,
            )
        provenance = {
            "versionName": VERSION, "versionCode": phone["versionCode"],
            "apkSha256": phone["apkSha256"],
            "sourceManifestSha256": phone["sourceManifestSha256"],
            "staticTailExtensions": movie.static_extensions,
            "videoSha256": sha256_file(output), "videoDurationSeconds": probe_duration(output),
            "phoneRecording": phone, "aaosRecording": aaos,
            "inputClips": [{"platform": role, "file": name,
                            "sha256": sha256_file(directory / name)}
                           for role, directory, names in (("phone", phone_dir, PHONE_NAMES),
                                                          ("aaos", aaos_dir, AAOS_NAMES))
                           for name in names],
            "limits": ["synthetic signal demonstration", "no received live traffic signals",
                       "AAOS idling restrictions; no sustained moving state",
                       "not tested on Pleos or a production vehicle", "not a DO approval"],
        }
        with sidecar.open("x", encoding="utf-8") as stream:
            json.dump(provenance, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        print(f"영상 생성: {output}\nSHA-256: {provenance['videoSha256']}\nManifest: {sidecar}")
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f"영상 합성 실패: {error}", file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
