"""Drive the real Docker Pi UI through a pseudo-terminal; no real API/Git usage."""

import fcntl
import os
from pathlib import Path
import pty
import select
import struct
import subprocess
import sys
import termios
import time

network, image, name = sys.argv[1:]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 110, 0, 0))
process = subprocess.Popen([
    "docker", "run", "--rm", "-it", "--name", name, "--init", "--network", network,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", "32", "--memory", "768m",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=32m",
    "-e", "TERM=xterm-256color", image,
], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
output = bytearray()


def until(text, timeout=40):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if text in output.decode("utf-8", errors="replace"):
            return
        if select.select([master], [], [], 0.1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            output.extend(chunk)
        if process.poll() is not None:
            break
    raise AssertionError(f"TUI did not reach {text!r}: {output[-2500:].decode('utf-8', errors='replace')}")


try:
    until("Ready — tell Pi")
    os.write(master, b"Make my bot play as Falco.\r")
    until("Your Falco bot has been published by the test publisher.")
    assert b"Published version:" in output
    assert b"9360" in output
    assert b"import melee" not in output, "Code tool results should remain hidden in the kid UI."
    os.write(master, b"/new\r")
    until("New chat. Your bot draft has not changed.")
    os.write(master, b"/quit\r")
    process.wait(timeout=10)
    assert process.returncode == 0
    print("Real terminal UI: prompt → bot edit → real Python verification → test submission; /new and /quit passed.")
finally:
    if process.poll() is None:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        process.kill()
        process.wait()
    os.close(master)
