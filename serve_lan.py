#!/usr/bin/env python3
"""
同じ Wi-Fi の iPad などから開く用。
0.0.0.0 で待ち受け（python -m http.server より確実なことが多い）。
"""
from __future__ import annotations

import http.server
import os
import re
import socket
import socketserver
import subprocess
import sys


def _darwin_ipconfig_addrs() -> list[str]:
    """ifconfig が すくないときでも、Wi‑Fi などの IP を とりやすい（macOS）。"""
    out: list[str] = []
    if sys.platform != "darwin":
        return out
    for iface in ("en0", "en1"):
        try:
            r = subprocess.run(
                ["/usr/sbin/ipconfig", "getifaddr", iface],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            ip = (r.stdout or "").strip()
            if ip and re.match(r"^\d{1,3}(\.\d{1,3}){3}$", ip) and not ip.startswith(
                "127."
            ):
                out.append(ip)
        except (OSError, subprocess.TimeoutExpired):
            pass
    return out


def _ipv4_addrs() -> list[str]:
    out: list[str] = []
    try:
        r = subprocess.run(
            ["/sbin/ifconfig"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        for m in re.finditer(
            r"inet (\d{1,3}(?:\.\d{1,3}){3})\s", r.stdout or ""
        ):
            ip = m.group(1)
            if not ip.startswith("127."):
                out.append(ip)
    except (OSError, subprocess.TimeoutExpired):
        pass
    merged = list(dict.fromkeys(_darwin_ipconfig_addrs() + out))
    return merged


def _primary_lan_ipv4() -> str | None:
    """UDP で 外向きルートのローカルIPを推定（補助。VPN があると ずれることがある）。"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.3)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except OSError:
        pass
    return None


def _local_hostname() -> str | None:
    try:
        r = subprocess.run(
            ["scutil", "--get", "LocalHostName"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        name = (r.stdout or "").strip()
        return name if name else None
    except OSError:
        return None


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--open"]
    port = int(args[0]) if args else 8765
    do_open = "--open" in sys.argv[1:]
    root = os.path.dirname(os.path.realpath(__file__))
    os.chdir(root)

    if not os.path.isfile(os.path.join(root, "index.html")):
        print("")
        print("⚠ ここでは index.html が みつからないよ。")
        print(f"   いまのフォルダ: {root}")
        print("")
        print("   「english-lesson-pwa」フォルダの なかの serve_lan.py を 動かしてね。")
        print("   Finder でフォルダをひらき、ターミナルで:")
        print("     cd （フォルダをドラッグ）")
        print("     python3 serve_lan.py --open")
        print("")
        raise SystemExit(1)

    ips = _ipv4_addrs()
    guess = _primary_lan_ipv4()
    if guess and guess not in ips:
        ips = list(dict.fromkeys([guess] + ips))
    local = _local_hostname()

    print("")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  【まずこの Mac で ひらく（いちばんかんたん）】")
    print(f"    http://127.0.0.1:{port}/")
    print("    ブラウザのアドレスバーに そのまま コピペ。https に しない。")
    print("")
    print("  別ターミナルで ブラウザをひらきたいとき:")
    print(f"    open http://127.0.0.1:{port}/")
    print("")
    print("  ─────────  iPad / ほかの機器  ─────────")
    print("  まず かんたん チェック（文字だけ。JS いらない）:")
    if local:
        print(f"    http://{local}.local:{port}/ipad-check.html")
    for ip in ips[:1]:
        print(f"    http://{ip}:{port}/ipad-check.html")
    if not ips and not local:
        print(f"    http://（あなたのMacのIPv4）:{port}/ipad-check.html")
    print("")
    print("  つぎに ほんばん:")
    print("")
    if local:
        print(f"    http://{local}.local:{port}/")
        print("      （Apple どうしだと こちらが つながりやすい ことがある）")
        print("")
    for ip in ips:
        print(f"    http://{ip}:{port}/")
    if not ips and not local:
        print("    （IP が とれなかった）")
        print("    システム設定 → ネットワーク → Wi-Fi → 詳細 → TCP/IP")
        print("    の「IPv4 アドレス」を みて  http://その数字:{port}/")
    print("")
    print("  • http:// のまま（https に しない）")
    print("  • Mac と iPad は おなじ Wi-Fi")
    print("  • ファイアウォール: 「Python」や「ターミナル」の 着信を 許可")
    print("  • iPad の Wi‑Fi 詳細で「プライベートWi‑Fiアドレス」を いったんオフして試すこともある")
    print("  • 止める: Control+C")
    print("")
    print("  まったくつながらないとき（どこからでもひらきたい）:")
    print("    https://app.netlify.com/drop に このフォルダごと ドロップ")
    print("    → 出てきた https://〜.netlify.app を iPad でひらく")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("")

    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {
            **http.server.SimpleHTTPRequestHandler.extensions_map,
            "json": "application/json; charset=utf-8",
            "js": "application/javascript; charset=utf-8",
            "css": "text/css; charset=utf-8",
            "html": "text/html; charset=utf-8",
        }

        def end_headers(self) -> None:
            raw_path = getattr(self, "path", "")
            raw = raw_path.split("?", 1)[0] if isinstance(raw_path, str) else ""
            if raw.endswith(".json") or raw.endswith(".js") or raw.endswith(".html"):
                self.send_header("Cache-Control", "no-store, max-age=0")
            super().end_headers()

    class Server(socketserver.TCPServer):
        allow_reuse_address = True

    if do_open and sys.platform == "darwin":
        import threading
        import webbrowser

        def _open_browser() -> None:
            webbrowser.open(f"http://127.0.0.1:{port}/")

        threading.Timer(0.6, _open_browser).start()

    try:
        httpd = Server(("0.0.0.0", port), Handler)
    except OSError as e:
        if getattr(e, "errno", None) == 48 or "Address already in use" in str(e):
            print("")
            print(f"⚠ ポート {port} は すでに つかわれてるよ。")
            print(f"  ちがうポートで:  python3 serve_lan.py {port + 1}")
            print("  または つかってる アプリを 止める。")
            print("")
        raise SystemExit(1) from e

    with httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n停止しました。")


if __name__ == "__main__":
    main()
