"""Trusted diagnostic, streamed to the supervisor's interpreter by smoke tests."""

import json
import sys

sys.path.insert(0, "/opt/smash/validator")
from worker import sandbox_command

PROBE = r'''
import json, os, resource, socket, subprocess, sys
assert os.getuid() == 65534 and os.getgid() == 65534
assert os.getgroups() == []
assert resource.getrlimit(resource.RLIMIT_NPROC) == (1, 1)
assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)
assert not any("TOKEN" in key or "API_KEY" in key for key in os.environ)
status = open("/proc/self/status").read()
for line in status.splitlines():
    if line.startswith(("CapEff:", "CapPrm:", "CapAmb:")):
        assert int(line.split()[1], 16) == 0, line
    if line.startswith("NoNewPrivs:"):
        assert line.split()[1] == "1", line

def denied(operation):
    try:
        operation()
    except OSError:
        return
    raise AssertionError("An isolated operation unexpectedly succeeded")

denied(lambda: open("/opt/smash/validator/worker.py", "w"))
denied(lambda: open("/tmp/evil", "w"))
denied(lambda: open("/jobs/evil", "w"))
denied(lambda: open("/proc/1/environ", "rb"))
denied(lambda: os.setuid(0))
denied(lambda: os.kill(os.getppid(), 0))
denied(lambda: subprocess.Popen([sys.executable, "-c", "pass"]))
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(1)
denied(lambda: sock.connect(("1.1.1.1", 443)))
sock.close()
print(json.dumps({"ok": True}))
'''

output, error = sandbox_command([sys.executable, "-I", "-B", "-c", PROBE], "")
assert error is None, error
assert json.loads(output)["ok"]
_, error = sandbox_command([sys.executable, "-I", "-B", "-c", "while True: pass"], "", timeout=0.3)
assert error and "timed out" in error
print("Child UID, clean env, read-only files, inaccessible queue, signals, process/network limits, and timeout verified.")
