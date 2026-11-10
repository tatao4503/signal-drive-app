import json, subprocess
F='/System/Library/Fonts/AppleSDGothicNeo.ttc'; BG='0x0f1419'
def dur(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]).decode())
inputs=[]; parts=[]; n=0
def cap(name,text): p=f'cap/{name}.txt'; open(p,'w',encoding='utf-8').write(text); return p
def dt(tf,size,x,y,color='white',extra=''): return f"drawtext=fontfile={F}:textfile={tf}:fontsize={size}:fontcolor={color}:x={x}:y={y}:line_spacing={int(size*0.45)}{extra}"
def card(name,lines,d):
    global n
    fl=[dt(cap(f'{name}{i}',t),s,'(w-text_w)/2',y,c) for i,(t,s,c,y) in enumerate(lines)]
    parts.append(f"color=c={BG}:s=1920x1080:d={d}:r=30,{','.join(fl)},format=yuv420p[s{n}]"); n+=1
card('title',[('SIGNAL Drive',96,'white',330),('확인된 신호만 보여주고,\n확인할 수 없으면 아무것도 보여주지 않습니다',48,'0x8fe3bf',500),('현대자동차그룹 차량용 앱 개발 공모전 출품작',30,'0x9aa4ad',760)],4.5)
NP=cap('note_phone','일반 Android 14 에뮬레이터 화면 녹화\n화면의 신호는 합성 시연 데이터입니다 (실제 신호 아님)')
NA=cap('note_aaos','Android Automotive 13 에뮬레이터 화면 녹화 (Pleos·실차 아님)')
def aaos(name,src,ss,to,caps):
    global n
    inputs.append(['-i',src]); k=len(inputs)-1
    fl=[f"[{k}:v]trim=start={ss}:end={to},setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration={to-ss},trim=duration={to-ss},scale=1104:828,setsar=1,pad=1920:1080:408:14:color={BG}",dt(NA,24,'(w-text_w)/2',1044,'0x9aa4ad')]
    for i,(a,b,t) in enumerate(caps): fl.append(dt(cap(f'{name}{i}',t),36,'(w-text_w)/2',872,'white',f":enable='between(t,{a},{b})'"))
    parts.append(','.join(fl)+f",format=yuv420p[s{n}]"); n+=1
aaos('aaosA','aaos-1-live.mp4',0.3,6.0,[(0,99,'실제 데이터 화면\n현장에서 검증된 교차로가 없으면 신호를 표시하지 않습니다')])
CAPS=['시연 데이터\n확인된 신호는 색과\n남은 시간을 함께 보여줍니다',
 '데이터가 늦게 오면\n→ 색과 숫자를 지우고\n   이유만 보여줍니다',
 '새 데이터가 오면\n다시 표시합니다',
 '연결이 끊기면\n→ 표시 중단',
 '다른 교차로의 데이터는\n쓰지 않습니다',
 '진입 방향을 모르면\n표시하지 않습니다',
 '유효시간이 끝난 신호로\n다음 색을 추측하지 않습니다',
 '새 데이터가 오면\n다시 표시합니다',
 '주행 화면 미리보기 (모의 주행)\n신호·남은 시간·이유만 남기고\n설정·시연 입력을 잠급니다\n실제 차량에서는 시연 신호도 끕니다',
 '기기 시계가 바뀌면\n즉시 보류합니다',
 '시계를 되돌려도\n지난 신호를 다시 꺼내지 않습니다',
 '새 데이터가 들어온 뒤에만\n다시 표시합니다']
clips=json.load(open('phone-clips.json',encoding='utf-8'))
for i,c in enumerate(clips):
    f=c['file']; d0=dur(f); D=min(d0,6.0) if '09-driving' in f else min(d0,5.0)
    inputs.append(['-i',f]); k=len(inputs)-1
    fl=[f"[{k}:v]setpts=PTS-STARTPTS,fps=30,scale=-2:1040,setsar=1,tpad=stop_mode=clone:stop_duration={max(0,D-d0)+0.2},trim=duration={D},pad=1920:1080:240:20:color={BG}",
        dt(cap(f'p{i}',CAPS[i]),54,820,'(h-text_h)/2-60','white'),dt(NP,26,820,950,'0x9aa4ad')]
    parts.append(','.join(fl)+f",format=yuv420p[s{n}]"); n+=1
aaos('aaosB','aaos-2-drive.mp4',0.0,20.0,[(0,5.6,'정차 중에는 시연 데이터를 볼 수 있습니다'),
  (5.6,14.4,'주행이 시작되면 시연 데이터를 자동으로 끄고 주행 화면으로 바꿉니다\n주행 중에는 검증된 실제 신호만 표시합니다 (주행 중 사용 선언 · 에뮬레이터 확인)'),
  (14.4,99,'정차하면 일반 화면으로 돌아옵니다\n시연은 사용자가 다시 켤 때만 표시됩니다')])
card('end',[('이 영상은 에뮬레이터 화면 녹화입니다',44,'white',360),('Pleos·실차 실행이 아니며, 화면의 신호는 모두 합성 시연 데이터입니다.\n실제 신호 표시는 현장 검증된 교차로 매핑이 등록된 뒤에만 켜지고,\n주행 허용은 Pleos·실차 심사를 받지 않았습니다.',32,'0x9aa4ad',470),('SIGNAL Drive v0.2',30,'0x8fe3bf',700)],6)
fc=';'.join(parts)+';'+''.join(f'[s{i}]' for i in range(n))+f'concat=n={n}:v=1:a=0[out]'
open('filter.txt','w',encoding='utf-8').write(fc)
r=subprocess.run(['ffmpeg','-v','error','-y']+sum(inputs,[])+['-filter_complex_script','filter.txt','-map','[out]','-c:v','libx264','-crf','20','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart','SIGNAL-Drive-v0.2-시연영상.mp4'],capture_output=True,text=True)
print(r.returncode, r.stderr[-800:])
