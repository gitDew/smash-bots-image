"""Credential-free validator parent. Poll jobs; never execute source as root."""

import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent
# -I excludes the script directory; add only this immutable, administrator-owned path.
sys.path.insert(0, str(ROOT))
from policy import check_source
JOB_ROOT = Path("/jobs")


def child_limits():
    """Called immediately before exec, in the child only (Linux container)."""
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_NPROC, (1, 1))
    resource.setrlimit(resource.RLIMIT_CPU, (6, 6))
    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024, 16 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def sandbox_command(command, input_text, timeout=10):
    if sys.platform != "linux" or os.getuid() != 0:
        raise RuntimeError("Sandbox execution requires the Linux validator container; it must never fall back to host execution.")
    # Output goes to a root-owned inherited file descriptor: RLIMIT_FSIZE bounds
    # noisy or malicious code, unlike an unbounded communicate() stdout pipe.
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=output, stderr=output,
            cwd=str(ROOT), preexec_fn=child_limits,
            env={
                "PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/nonexistent",
                "LANG": "C.UTF-8", "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1",
            },
        )
        try:
            process.communicate(input=input_text.encode("utf-8"), timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            return None, "Bot timed out. Remove infinite loops or expensive work from import/__init__/act."
        output.seek(0)
        text = output.read(16 * 1024 + 1).decode("utf-8", errors="replace")
        if process.returncode != 0 or len(text.encode("utf-8")) > 16 * 1024:
            return None, "Bot exceeded sandbox limits or crashed. Keep it small and do not create processes/files."
        return text, None


def verify_source(source, expected_hash):
    actual_hash = hashlib.sha256(source.encode("utf-8")).hexdigest() if isinstance(source, str) else ""
    failure = {"ok": False, "sha256": actual_hash}
    if actual_hash != expected_hash:
        return {**failure, "message": "Verification input hash did not match."}
    try:
        check_source(source)
    except (ValueError, SyntaxError, RecursionError, UnicodeError) as error:
        return {**failure, "message": f"{error.__class__.__name__}: {str(error)[:700]}"}
    output, error = sandbox_command(
        [sys.executable, "-I", "-B", str(ROOT / "run_bot.py")], json.dumps({"code": source}),
    )
    if error:
        return {**failure, "message": error}
    try:
        result = json.loads(output)
        if result.get("sha256") != actual_hash or not isinstance(result.get("ok"), bool) or not isinstance(result.get("message"), str):
            raise ValueError("Invalid result")
        return {
            "ok": result["ok"], "sha256": actual_hash, "message": result["message"][:4096],
            **({"checks": result["checks"]} if isinstance(result.get("checks"), int) else {}),
        }
    except (ValueError, TypeError):
        return {**failure, "message": "Bot interfered with the verification result. Nothing was published."}


def process_job(job):
    request = json.loads((job / "request.json").read_text(encoding="utf-8"))
    result = verify_source(request.get("code"), request.get("sha256"))
    temporary = job / f"result.{uuid.uuid4()}.tmp"
    # Group 1000 is the trusted broker. The unprivileged bot's UID/GID is 65534:
    # it cannot read jobs, forge results, signal this parent, or mutate the queue.
    with temporary.open("x", encoding="utf-8") as file:
        json.dump(result, file)
    temporary.chmod(0o640)
    temporary.replace(job / "result.json")


def main():
    if sys.platform != "linux" or os.getuid() != 0 or os.getgid() != 1000:
        raise RuntimeError("Start the validator as 0:1000 using the supplied Compose configuration.")
    os.umask(0o007)
    print("Validator ready. Bot children run unprivileged, without network or credentials.", flush=True)
    while True:
        for job in sorted(JOB_ROOT.iterdir()):
            if not job.is_dir() or not (job / "request.json").is_file() or (job / "result.json").exists():
                continue
            try:
                process_job(job)
            except FileNotFoundError:
                pass  # The broker timed out and removed the job.
            except Exception:
                print("Invalid verification job; no code was published.", file=sys.stderr, flush=True)
        time.sleep(0.1)


if __name__ == "__main__":
    main()
