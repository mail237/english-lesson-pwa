#!/bin/sh
# iPad など LAN から開く（serve_lan.py で 0.0.0.0 待受）
# 例: ./serve-lan.sh --open  → Macのブラウザが自動でひらく
cd "$(dirname "$0")" || exit 1
exec python3 ./serve_lan.py "$@"
