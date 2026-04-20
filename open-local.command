#!/bin/bash
# 英語名ファイル（日本語ファイル名でうまくいかないとき用）
cd "$(dirname "$0")" || exit 1
if [ ! -f index.html ]; then
  echo "index.html がありません。このファイルと同じフォルダにいますか？"
  echo "場所: $(pwd)"
  read -r _
  exit 1
fi
echo "サーバー起動… ブラウザがひらきます（止める: Control+C）"
exec python3 ./serve_lan.py --open
