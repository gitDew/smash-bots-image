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
    until("Ready — tell me")
    assert b"/verify" not in output and b"/submit" not in output and b"/quit" not in output
    os.write(master, b"Make my bot play as Falco.\r")
    # A second Enter while Pi is busy queues a normal prompt, with no extra commands.
    os.write(master, b"Explain my bot without changing it.\r")
    until("Your Falco bot is ready!")
    until("Your bot chases nearby opponents.")
    assert b"Published version:" not in output
    assert b"9360" not in output
    assert b"Analog input" not in output, "Repair diagnostics should remain hidden from children."
    assert b"import melee" not in output, "Code tool results should remain hidden in the kid UI."
    os.write(master, b"/submit\r")
    until("Slash text is a regular prompt.")  # No direct UI submission endpoint.
    os.write(master, b"\x03")  # Organizer stops the terminal; children need no commands.
    process.wait(timeout=10)
    assert process.returncode == 0
    print("Prompt-only UI: Enter → edit → failed verification → automatic repair → verify → test submission; queued prompts and no slash dispatch passed.")
finally:
    if process.poll() is None:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        process.kill()
        process.wait()
    os.close(master)
