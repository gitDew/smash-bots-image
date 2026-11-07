#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
PREFIX=${IMAGE_PREFIX:-smash-bots}
TAG=${IMAGE_TAG:-dev}
NAME="smash-smoke-$$"
JOBS="${NAME}-jobs"
NETWORK="${NAME}-private"
VALIDATOR="${NAME}-validator"
BROKER="${NAME}-broker"
UI="${NAME}-ui"
STATE="${NAME}-state"

cleanup() {
  docker rm -f "$UI" "$BROKER" "$VALIDATOR" >/dev/null 2>&1 || true
  docker volume rm "$JOBS" "$STATE" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker info >/dev/null
node tests/compose-env-smoke.mjs
docker volume create "$JOBS" >/dev/null
docker volume create "$STATE" >/dev/null
docker network create --internal "$NETWORK" >/dev/null

docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700 \
  --entrypoint pi "${PREFIX}:agent-${TAG}" --version

docker run -d --name "$VALIDATOR" --init --network none --read-only \
  --user 0:1000 --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add KILL \
  --security-opt no-new-privileges --pids-limit 16 --memory 512m --cpus 1 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=0700 \
  --mount "type=volume,source=$JOBS,target=/jobs" "${PREFIX}:validator-${TAG}" >/dev/null

# Stream the trusted diagnostic in; Docker cp refuses a read-only rootfs even
# when its destination is tmpfs. No mutable scripts are installed in the image.
docker exec -i "$VALIDATOR" python3 -I -B - < tests/sandbox-probe.py

docker run --rm --init --network none --read-only --user 1000:1000 \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 512m \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700 \
  --mount "type=volume,source=$JOBS,target=/jobs" \
  --mount "type=bind,source=$ROOT/tests/container-checks.mjs,target=/opt/smash/container-checks.mjs,readonly" \
  --entrypoint node "${PREFIX}:broker-${TAG}" /opt/smash/container-checks.mjs

# Actual kernel/network boundary, not just an absent web tool.
docker run --rm --network "$NETWORK" --read-only --cap-drop ALL \
  --security-opt no-new-privileges --entrypoint node "${PREFIX}:agent-${TAG}" \
  --input-type=module -e '
    import assert from "node:assert/strict";
    assert.equal(process.getuid(), 1000);
    assert.equal(process.env.GITHUB_TOKEN, undefined);
    assert.equal(process.env.OPENCODE_API_KEY, undefined);
    let connected = false;
    try { await fetch("https://1.1.1.1", {signal: AbortSignal.timeout(1500)}); connected = true; } catch {}
    assert.equal(connected, false, "The UI must not reach the public internet");
    const {createTeamSession} = await import("/opt/smash/dist/agent.js");
    const {loadConfig} = await import("/opt/smash/dist/config.js");
    const {BrokerClient,LocalDocs} = await import("/opt/smash/dist/tools.js");
    const c = loadConfig({TEAM_ID:"team_a",TEAM_REPO_URL:"https://github.com/example/a.git",GITHUB_TOKEN:"dummy",OPENCODE_API_KEY:"dummy",LLM_PROVIDER:"opencode-go",LLM_MODEL:"kimi-k2.6"});
    const s = await createTeamSession(c.publicConfig,new BrokerClient(),new LocalDocs("/opt/smash/docs/libmelee"),"Only edit bot.py.");
    assert.equal(s.sessionFile, undefined);
    assert.deepEqual(s.getActiveToolNames().sort(), ["read_bot","read_docs","search_docs","save_bot","verify_bot","submit_bot"].sort());
    s.dispose();
    console.log("Restricted UI tools and blocked external egress verified.");
  '
# Exercise the actual kid-facing entrypoint/TUI, real bot tools, and real validator.
# Only the model SSE responses and publisher are fake; no credentials or public network.
docker run -d --name "$BROKER" --init --network "$NETWORK" --network-alias broker \
  --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=32m \
  --mount "type=volume,source=$STATE,target=/state" \
  --mount "type=volume,source=$JOBS,target=/jobs" \
  --mount "type=bind,source=$ROOT/tests/mock-broker.mjs,target=/opt/smash/mock-broker.mjs,readonly" \
  --entrypoint node "${PREFIX}:broker-${TAG}" /opt/smash/mock-broker.mjs >/dev/null
for attempt in $(seq 1 20); do
  if docker exec "$BROKER" node -e 'fetch("http://127.0.0.1:8080/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then break; fi
  sleep 1
done
python3 tests/tui-smoke.py "$NETWORK" "${PREFIX}:agent-${TAG}" "$UI"
docker exec "$BROKER" node -e 'const f=require("node:fs");const p=JSON.parse(f.readFileSync("/state/test-published.json","utf8"));if(!/^[a-f0-9]{40}$/.test(p.commit)||!f.readFileSync("/state/bot.py","utf8").includes("return melee.Character.FALCO"))process.exit(1)'
printf '%s\n' 'All container smoke tests passed.'
