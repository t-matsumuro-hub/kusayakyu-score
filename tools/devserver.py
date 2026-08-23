"""開発用の静的サーバ。

    python tools/devserver.py [port]

ブラウザにも Service Worker にもキャッシュさせないヘッダを付けて配信する。
標準の http.server だと Cache-Control が付かず、ブラウザが独自判断で
古いファイルを使い続けてしまい、修正が反映されないことがあるため。
"""
import functools
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 静かに動かす（エラーだけ出す）
        if args and str(args[0]).startswith(("GET", "HEAD")) and "200" in " ".join(str(a) for a in args):
            return
        super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"serving {ROOT} at http://127.0.0.1:{port}/ (no-cache)")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
