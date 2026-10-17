#!/usr/bin/env python3
"""ReView one-click launcher (cross-platform: Windows / macOS / Linux).

Usage:
    python start.py           # install deps if needed, start app, open browser
    python start.py --check   # verify prerequisites only, start nothing

On Windows you can simply double-click Start.bat instead (no Python needed).
In the future the built installers (.exe / .dmg / .AppImage) will be published
via GitHub Releases and linked from desktop-showcase/README.md — binaries are
never committed to git.
"""
import shutil
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

UI_URL = "http://localhost:5173/"
WAIT_SECONDS = 60

ROOT = Path(__file__).resolve().parent.parent


def fail(msg: str) -> int:
    print(f"[ERROR] {msg}")
    if sys.platform == "win32" and sys.stdin.isatty():
        input("Press Enter to close...")
    return 1


def wait_for_port(port: int, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def check() -> int:
    ok = True
    node = shutil.which("node")
    print(f"node: {node or 'NOT FOUND'}")
    ok = ok and bool(node)
    npm = shutil.which("npm")
    print(f"npm: {npm or 'NOT FOUND'}")
    ok = ok and bool(npm)
    print(f"repo root: {ROOT} ({'package.json OK' if (ROOT / 'package.json').exists() else 'MISSING package.json'})")
    ok = ok and (ROOT / "package.json").exists()
    print(f"node_modules: {'present' if (ROOT / 'node_modules').exists() else 'missing (will run npm ci)'}")
    print("check:", "OK" if ok else "FAILED")
    return 0 if ok else 1


def main() -> int:
    if "--check" in sys.argv:
        return check()
    if check() != 0:
        return fail("Install Node.js LTS from https://nodejs.org and retry.")
    if not (ROOT / "node_modules").exists():
        print("Installing dependencies (one-time, may take a few minutes)...")
        if subprocess.run(["npm", "ci"], cwd=ROOT).returncode != 0:
            return fail("npm ci failed.")
    print("Starting ReView (sync + UI)...")
    proc = subprocess.Popen(["npm", "run", "dev"], cwd=ROOT)
    try:
        if wait_for_port(5173, WAIT_SECONDS):
            print(f"Opening {UI_URL}")
            webbrowser.open(UI_URL)
        else:
            print("UI did not come up in time — check the log above.")
        print("App is running. Press Ctrl+C here to stop.")
        proc.wait()
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        if proc.poll() is None:
            proc.terminate()
    print("Stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
