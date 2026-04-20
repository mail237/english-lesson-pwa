#!/bin/bash
# ダブルクリックで ターミナルがひらき、サーバー起動＆Macのブラウザで表示
cd "$(dirname "$0")" || exit 1
echo ""
echo "このウィンドウは とじないでください（止めるときは Control+C）"
echo ""
exec python3 ./serve_lan.py --open
