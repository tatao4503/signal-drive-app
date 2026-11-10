#!/bin/zsh
set -eu
unsetopt BG_NICE
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  print "Node.js 22 이상을 설치한 뒤 다시 실행하세요."
  read -r "reply?Enter 키를 누르면 닫힙니다. "
  exit 1
fi
node server/start.mjs &
signal_drive_server=$!
trap 'kill "$signal_drive_server" 2>/dev/null || true' EXIT INT TERM
for i in {1..30}; do
  if curl -fsS --max-time 1 http://127.0.0.1:3217/api/health >/dev/null 2>&1; then
    open http://127.0.0.1:3217
    break
  fi
  sleep 0.1
done
print "SIGNAL Drive 실행 중입니다. 종료하려면 이 창에서 Ctrl+C를 누르세요."
wait "$signal_drive_server"
