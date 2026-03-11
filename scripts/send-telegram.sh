#!/bin/bash
# send-telegram.sh — telegram-pending 파일을 Vercel API 경유로 텔레그램 발송
# 사용법: ./scripts/send-telegram.sh [파일경로]
# 파일경로 생략 시 quant-reports/telegram-pending-*.txt 전체 발송

SEND_URL="https://signal-screener.vercel.app/api/telegram-send"
REPORT_DIR="$(dirname "$0")/../quant-reports"

send_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "❌ 파일 없음: $file"
    return 1
  fi

  local text
  text=$(cat "$file")
  if [ -z "$text" ]; then
    echo "⚠️ 빈 파일: $file"
    return 1
  fi

  # JSON escape
  local json
  json=$(python3 -c "import sys,json; print(json.dumps({'text': sys.stdin.read()}))" < "$file")

  local response
  response=$(curl -s -X POST "$SEND_URL" \
    -H "Content-Type: application/json" \
    -d "$json" \
    --max-time 15 2>&1)

  if echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
    echo "✅ 발송 완료: $(basename "$file")"
    # 발송 완료 후 sent 폴더로 이동
    local sent_dir="$REPORT_DIR/telegram-sent"
    mkdir -p "$sent_dir"
    mv "$file" "$sent_dir/$(basename "$file")"
    return 0
  else
    echo "❌ 발송 실패: $(basename "$file") — $response"
    return 1
  fi
}

# 단일 파일 지정 시
if [ -n "$1" ]; then
  send_file "$1"
  exit $?
fi

# 전체 pending 파일 발송
count=0
success=0
for f in "$REPORT_DIR"/telegram-pending-*.txt; do
  [ -f "$f" ] || continue
  count=$((count + 1))
  if send_file "$f"; then
    success=$((success + 1))
  fi
  sleep 1  # rate limit 방지
done

echo "📊 결과: ${success}/${count} 발송 완료"
