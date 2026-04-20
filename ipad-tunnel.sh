#!/bin/bash
# 家のWi-Fiがじゃまでも iPad からひらける（インターネット経由の一時URL）
# 要: brew install cloudflared  または https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
set -e
cd "$(dirname "$0")" || exit 1
test -f index.html || { echo "index.html がありません。このフォルダで実行してください。"; exit 1; }

PORT="${1:-8765}"
echo ""
echo "ローカルサーバーをバックグラウンドで起動 → Cloudflare トンネル…"
echo "（止めるときは Control+C。サーバーも止まります）"
echo ""

python3 ./serve_lan.py "$PORT" &
PY_PID=$!
cleanup() {
  kill "$PY_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT
sleep 2

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared が みつかりません。"
  echo "  Mac で:  brew install cloudflared"
  echo "  または公式から .pkg インストール"
  echo ""
  echo "トンネルなしで LAN だけ試すなら:"
  echo "  python3 serve_lan.py"
  exit 1
fi

echo "↓ に https://〜〜 が でたら、それを iPad の Safari に はりつけてね"
echo ""
cloudflared tunnel --url "http://127.0.0.1:$PORT"
