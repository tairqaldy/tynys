"""Local development server: http://127.0.0.1:8787/api/{meta,air,plan,route,places}

    python -m tynys.devserver [--port 8787]

Check first that the port is free:  lsof -nP -iTCP:8787 -sTCP:LISTEN
"""

import argparse
from http.server import ThreadingHTTPServer

from tynys.web import ApiHandler


class DevHandler(ApiHandler):
    endpoint = None  # route by path

    def log_message(self, fmt, *args):
        print("%s %s" % (self.address_string(), fmt % args), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), DevHandler)
    print(f"Tynys API on http://127.0.0.1:{args.port}/api/ (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
