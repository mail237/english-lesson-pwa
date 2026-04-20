#!/usr/bin/env bash
# ラジオの m4a を english-lesson-pwa の media/radio にコピー（パスに空白があっても可）
# 著作権: 私的利用の範囲で。音声の再配布や公開リポジトリへの無断アップロードはしないこと。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT/media/radio"
DEST_NAME="heart-gokui-2026-04-17-ep15.m4a"

if [[ $# -lt 1 ]]; then
  echo "使い方: $0 /path/to/episode.m4a"
  echo "省略時の保存先: $DEST_DIR/$DEST_NAME"
  exit 1
fi

SRC=$1
mkdir -p "$DEST_DIR"
cp -f "$SRC" "$DEST_DIR/$DEST_NAME"
ls -la "$DEST_DIR/$DEST_NAME"
