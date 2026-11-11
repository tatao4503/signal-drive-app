# SIGNAL Drive 0.2.1 시연 영상 재편집 (2026-11-11)
# 녹화 원본(recording-phone/, recording-aaos/)이 있는 폴더에 두고 실행한다. 원본은 0.2.1 APK로 녹화한 것(SHA는 영상 manifest 참고).
# 같은 0.2.1 녹화 원본(recording-phone/, recording-aaos/)의 순서·길이만 바꾼다. 새로 녹화하지 않는다.
# 목적: 신호가 '보이는' 장면을 앞에, 크게. '확인 불가' 장면은 짧게 이어 붙인다.
import subprocess, os
HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, 'recording-phone'); A = os.path.join(HERE, 'recording-aaos')
OUT = os.path.join(HERE, 'final-edit'); os.makedirs(os.path.join(OUT, 'cap'), exist_ok=True)
F = '/System/Library/Fonts/AppleSDGothicNeo.ttc'; BG = '0x0f1419'
inputs = []; parts = []; n = 0
def cap(name, text):
    p = os.path.join(OUT, 'cap', f'{name}.txt'); open(p, 'w', encoding='utf-8').write(text); return p
def dt(tf, size, x, y, color='white', extra=''):
    return f"drawtext=fontfile={F}:textfile={tf}:fontsize={size}:fontcolor={color}:x={x}:y={y}:line_spacing={int(size*0.45)}{extra}"
def card(name, lines, d):
    global n
    fl = [dt(cap(f'{name}{i}', t), s, '(w-text_w)/2', y, c) for i, (t, s, c, y) in enumerate(lines)]
    parts.append(f"color=c={BG}:s=1920x1080:d={d}:r=30,{','.join(fl)},format=yuv420p[s{n}]"); n += 1
NP = cap('note_phone', '일반 Android 14 에뮬레이터 · v0.2.1\n화면의 신호는 합성 시연 데이터입니다 (실제 신호 아님)')
NA = cap('note_aaos', 'Android Automotive 13 에뮬레이터 · v0.2.1 · 합성 시연 데이터 (Pleos·실차 아님)')
def phone(name, f, ss, d, text):
    global n
    inputs.append(['-i', os.path.join(P, f)]); k = len(inputs) - 1
    fl = [f"[{k}:v]trim=start={ss},setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration={d},trim=duration={d},scale=-2:1040,setsar=1,pad=1920:1080:240:20:color={BG}",
          dt(cap(name, text), 54, 820, '(h-text_h)/2-60'), dt(NP, 26, 820, 950, '0x9aa4ad')]
    parts.append(','.join(fl) + f",format=yuv420p[s{n}]"); n += 1
def aaos(name, f, ss, to, caps):
    global n
    inputs.append(['-i', os.path.join(A, f)]); k = len(inputs) - 1; d = to - ss
    fl = [f"[{k}:v]trim=start={ss}:end={to},setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration={d},trim=duration={d},scale=1104:828,setsar=1,pad=1920:1080:408:14:color={BG}",
          dt(NA, 24, '(w-text_w)/2', 1044, '0x9aa4ad')]
    for i, (a, b, t) in enumerate(caps):
        fl.append(dt(cap(f'{name}{i}', t), 36, '(w-text_w)/2', 872, 'white', f":enable='between(t,{a},{b})'"))
    parts.append(','.join(fl) + f",format=yuv420p[s{n}]"); n += 1

card('title', [('SIGNAL Drive', 96, 'white', 300),
               ('확인된 신호를, 크게, 한눈에', 56, '0x8fe3bf', 470),
               ('확인할 수 없으면 숨깁니다', 40, '0xc8d2d6', 570),
               ('현대자동차그룹 차량용 앱 개발 공모전 출품작 · v0.2.1', 28, '0x9aa4ad', 760)], 4.5)
phone('g1', 'clip-01-green.mp4', 0.6, 6.0, '확인된 신호는\n색과 남은 시간을\n크게 보여줍니다')
aaos('a_parked', 'aaos-2-drive.mp4', 0.0, 7.4, [(0, 99, '차량 화면에서도 같은 판정 · 정차 중 시연 화면')])
phone('drv', 'clip-09-driving.mp4', 0.6, 6.5, '주행 화면\n신호 · 남은 시간 · 이유만\n크게 남깁니다\n(모의 주행 미리보기)')
phone('dly', 'clip-02-delay.mp4', 0.6, 5.0, '데이터가 늦으면\n즉시 숨기고\n이유를 보여줍니다')
phone('rec', 'clip-03-recover.mp4', 0.6, 4.0, '새 데이터가 오면\n다시 켜집니다')
phone('dis', 'clip-04-disconnect.mp4', 0.6, 3.5, '연결이 끊기면 → 숨김')
phone('mis', 'clip-05-mismatch.mp4', 0.6, 3.5, '다른 교차로 데이터 → 숨김')
phone('dir', 'clip-06-direction.mp4', 0.6, 3.5, '진입 방향 미확정 → 숨김')
phone('exp', 'clip-07-expired.mp4', 0.6, 3.5, '유효시간 끝 → 숨김\n다음 색을 추측하지 않습니다')
phone('rec2', 'clip-08-recover.mp4', 0.6, 3.5, '복구되면 다시 표시')
phone('clk1', 'clip-10-clock-back.mp4', 0.6, 4.0, '기기 시계가 바뀌면\n즉시 보류')
phone('clk2', 'clip-11-clock-restore.mp4', 0.6, 4.0, '시계를 되돌려도\n지난 신호를\n되살리지 않습니다')
phone('new', 'clip-12-new-data.mp4', 0.6, 4.5, '새 데이터가 들어온 뒤에만\n다시 켜집니다')
aaos('a_drive', 'aaos-2-drive.mp4', 7.4, 22.9, [
    (0, 9.3, '실제 차량에서 주행이 시작되면 시연 데이터를 끄고 주행 화면으로 바꿉니다\n(검증된 실제 신호만 표시 · 현재 등록 교차로 0곳)'),
    (9.3, 99, '정차하면 일반 화면으로 돌아옵니다 · 시연은 사용자가 다시 켤 때만')])
aaos('a_live', 'aaos-1-live.mp4', 1.0, 6.5, [(0, 99, '실제 데이터 화면 · 현장 검증된 교차로가 등록되면 이곳에 신호가 표시됩니다\n(현재 등록 0곳이라 표시하지 않음)')])
card('end', [('SIGNAL Drive', 52, 'white', 330),
             ('확인된 신호만 보여주고, 확인할 수 없으면 아무것도 보여주지 않습니다', 34, '0x8fe3bf', 430),
             ('에뮬레이터 화면 녹화 · 화면의 신호는 모두 합성 시연 데이터 · Pleos·실차 실행 아님\n실제 신호등과 교통법규가 항상 우선합니다', 28, '0x9aa4ad', 560)], 5)
fc = ';'.join(parts) + ';' + ''.join(f'[s{i}]' for i in range(n)) + f'concat=n={n}:v=1:a=0[out]'
open(os.path.join(OUT, 'filter.txt'), 'w', encoding='utf-8').write(fc)
out = os.path.join(OUT, 'SIGNAL-Drive-v0.2.1-시연영상.mp4')
r = subprocess.run(['ffmpeg', '-v', 'error', '-y'] + sum(inputs, []) + ['-filter_complex_script', os.path.join(OUT, 'filter.txt'), '-map', '[out]',
                    '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], capture_output=True, text=True)
print(r.returncode, r.stderr[-800:])
