#!/bin/bash
# このファイルを ダブルクリック → サーバー起動（フォルダの場所を かんけいなく つかえる）
cd "$(dirname "$0")" || exit 1
export LANG=ja_JP.UTF-8
clear
echo ""
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ★ このウィンドウは とじないでください"
echo "  ★ 下に でる http://192.168... か http://〜.local を"
echo "    iPad の Safari に コピペ（https に しない）"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
exec python3 ./serve_lan.py --open
