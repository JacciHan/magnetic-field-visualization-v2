#!/usr/bin/env python3
"""Static file server with no-cache headers to prevent browser caching during development."""
import http.server
import socketserver
import sys
import os

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def guess_type(self, path):
        ctype = super().guess_type(path)
        # Ensure JS is served with correct MIME
        if path.endswith('.js'):
            return 'application/javascript'
        return ctype

if __name__ == "__main__":
    port = 8081
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with socketserver.TCPServer(("0.0.0.0", port), NoCacheHandler) as httpd:
        print(f"Serving on http://localhost:{port} (no-cache mode)")
        print(f"Directory: {os.getcwd()}")
        httpd.serve_forever()
