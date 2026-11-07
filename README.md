# Smash Bots team agent

A restricted **Pi 0.84.4** terminal for children to describe how their Melee bot
should behave. One reusable image set, four independently configured team
repositories. No Dolphin, game ISO, or arena runner is included.

## What the children see

A Pi-powered chat and a multiline prompt field. They can say things like
“play as Kirby, chase the nearest opponent, and jump back when you fall off”.
The agent reads the offline libmelee docs, changes `bot.py`, checks it, and publishes
it. Explanations remain short and friendly; code/documentation tool output is hidden.

**Children only type an idea and press Enter.** For a behavior change, the agent
reads/edits the bot, calls `verify_bot`, fixes failures, and calls `submit_bot`
automatically. They never have to request verification/submission, approve a
publication step, or learn commands. The transcript contains friendly replies;
source, Python diagnostics, JSON, and commit hashes stay hidden. Additional
prompts entered while Pi is busy are processed one at a time.

There are **no slash commands or command menus**. Slash-prefixed text, `!commands`,
and `@paths` are literal prompts, not direct UI actions. Verification/submission
remain fixed agent tools; the broker still revalidates before every push. Pure
explanations do not change/publish a bot, and explicit requests not to publish
are respected. An organizer can interrupt/exit with Escape/Ctrl+C; stopping and
relaunching keeps the saved draft and starts a fresh, temporary chat.

Ordinary Pi administration commands do **not** execute.
This uses Pi's SDK and TUI rather than its unrestricted CLI: simply hiding the
LLM's `bash` tool would not disable the CLI's `!`, file attachments, external
editor, sharing, or configuration commands.

## The security boundary

Always start through **`compose.yaml` and the supplied launchers**:

```text
kid-facing Pi ── private/internal network ── trusted broker ── model API + GitHub
                                                │
                                     private validation-job volume
                                                │
                              validator (network_mode: none, no secrets)
```

| Service | Access |
| --- | --- |
| `agent` | Six bot-specific tools; offline Markdown docs. Non-root, read-only filesystem, internal network only. No keys, Git repository, arbitrary file access, shell, websearch/webfetch, MCP, downloaded extensions, or Docker socket. |
| `broker` | Administrator-selected credentials, one fixed GitHub repository/branch, and one fixed model endpoint. Never imports/executes generated Python, never checks out repository files, and never loads repository configuration/extensions. |
| `validator` | Real `melee==0.47.3` and temporary validation jobs. No network or credentials. Supervisor starts as `0:1000` with only SETUID/SETGID/KILL, to launch and time-limit children as `65534:65534`. Children have zero effective/permitted/ambient capabilities, empty groups, a clean environment, read-only filesystem, and CPU/memory/process/output limits. They cannot read/write the job volume or signal the supervisor. |

The model can call **only** `read_bot`, `read_docs`, `search_docs`, `save_bot`,
`verify_bot`, and `submit_bot`. No operation takes a repository, branch, path,
shell command, or commit message. `save_bot` is an atomic, revision-checked write
to the broker's fixed `bot.py`. The agent itself has no writable repository mount.

The broker is **not** an unrestricted web/CONNECT proxy. It accepts only the
configured model API route/model and the six function declarations; native
server-side web/search/MCP/shell tools are rejected. It injects the real model
credential, does not forward caller credentials, and does not follow redirects.
Git is HTTPS-only to the configured GitHub URL, with hooks, signing, global Git
configuration, filesystem monitors, credential storage, and redirects disabled.

Every submission revalidates the **exact code snapshot** inside the validator.
A bare Git tree/commit is constructed so only root-level `bot.py` changes; all
other tracked entries are retained. There is no `git add .`, arbitrary Git tool,
force-push, or execution of remote code. Failed pushes preserve the commit for retry.

**Limits:** this protects the agent/generated code, not against someone who
controls the host Docker daemon or overrides the launcher. Docker/kernel isolation
is still a trust boundary; do not use privileged containers, mount host directories,
or expose Docker's socket. The AST policy is an extra guardrail, **not a Python
sandbox**. Smoke tests are not proof that a bot is harmless, wins, or handles every
real game state. The future arena integration must independently validate/isolate
remote bots before running them with arena permissions.

## Event setup: three Windows Intel PCs + one Apple Silicon Mac

Use **prebuilt, digest-pinned images and four private team bundles**. There are no
desktop shortcuts, double-click wrappers, or local laptop builds. The organizer
runs a small terminal launcher. Defaults assign teams A–C to Windows Intel and
team D to Apple Silicon; swap the `TEAM_*_PLATFORM` assignments if needed.

### 1. Configure the event privately on the organizer's Mac

```sh
npm ci --ignore-scripts
make init-event
```

This creates **`.env.event` with mode 600**, prefilled with:

- `https://github.com/gitDew/smash-team-a.git` through `smash-team-d.git`;
- three `linux/amd64` teams and one `linux/arm64` team;
- `ghcr.io/gitdew/smash-bots-image` and version `v0.1.0`;
- the existing `OPENCODE_API_KEY` from your local `.env`, if available, copied
  literally **without displaying it** or modifying `.env`.

For this event, use **Azure `DeepSeek-V4.1-Flash`** at
`https://lab-coding.openai.azure.com/openai/v1`. Set the shared model block as
shown in [`config/AZURE.md`](config/AZURE.md), then enter `AZURE_OPENAI_API_KEY`
locally. The legacy example may still contain OpenCode settings; do not use those
for this event. Provider/model selection is explicit, and there is no fallback.

Edit `.env.event` locally and fill `TEAM_A_GITHUB_TOKEN`, `TEAM_B_GITHUB_TOKEN`,
`TEAM_C_GITHUB_TOKEN`, and `TEAM_D_GITHUB_TOKEN`. Each must be a different
fine-grained token, scoped to the corresponding repo with Contents read/write.
Do not put tokens in chat, commit the master file, or copy it to a team laptop.

```sh
make check-event
```

This checks configuration **without contacting Azure or GitHub**, and without
printing keys. To test the configured Azure deployment live:

```sh
make check-model
```

That explicitly uses up to two model inference requests, streaming, and a read-only
doc-tool round-trip. It does not write bots or call GitHub; builds/CI never run it
automatically. See [`config/AZURE.md`](config/AZURE.md). GitHub push permissions
still need a separate live team submission test before the event.
`make init-event` refuses to overwrite an existing `.env.event`.

### CI diagnostics (organizer only)

GitHub CLI can inspect this private repository directly after one browser login:

```sh
gh auth login --hostname github.com --web --git-protocol https --scopes workflow
gh run list --repo gitDew/smash-bots-image
gh run view RUN_ID --repo gitDew/smash-bots-image --log-failed
```

Use your normal image-repository account, not team tokens or the Azure key. There
is no need to paste CI logs into chat. For a transient registry-upload failure:

```sh
gh run rerun RUN_ID --repo gitDew/smash-bots-image --failed
gh run watch RUN_ID --repo gitDew/smash-bots-image --exit-status
```

The workflow retries each image upload up to three times with bounded delays;
persistent failures still stop publication. It never rebuilds an image for a retry.

### 2. Publish the shared event images once

The implementation must first be committed/pushed to `gitDew/smash-bots-image`.
Use your normal image-repository Git credentials, **not the team tokens**. Review
staged files: `.env`, `.env.event`, `bundles/`, and generated release metadata are
ignored and must never be force-added.

After committing/reviewing the source, push the version tag:

```sh
git push origin HEAD
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` tests and builds on **native Intel Linux and native
ARM Linux**, runs the real container isolation/TUI tests, then publishes the exact
tested images using GitHub Actions' own `GITHUB_TOKEN`. No event credentials or
extra personal package token are required. It merges the architecture digests
into the three event manifests and creates a GitHub release with **`release.json`
only**. Existing published versions are not intentionally replaced; use a new tag
and update `IMAGE_TAG` for a new release.

The first GHCR package is private by default. On GitHub, go to your profile's
**Packages → smash-bots-image → Package settings → Change visibility → Public**.
There are no credentials in the images. This allows laptop pulls without registry
login; the **team bot repositories can and should stay private**.

Download `release.json` from the completed GitHub release into this project
folder (use your logged-in browser if the image source repository is private).
Its version/prefix must match `.env.event`.

### 3. Generate the four private laptop folders

```sh
make bundles
# Or choose a release file elsewhere:
# make bundles RELEASE_FILE=/path/to/release.json
```

Output:

```text
bundles/v0.1.0/
  team_a/  + team_a.zip   # Windows Intel
  team_b/  + team_b.zip   # Windows Intel
  team_c/  + team_c.zip   # Windows Intel
  team_d/  + team_d.zip   # Apple Silicon
```

Each contains only `compose.yaml`, public `runtime.env`, private
`credentials.env`, `README.txt`, and **one manual launcher** (`launch.ps1` or
`launch.sh`). Its credentials include only that team's token and the selected
shared model key—never another team's token or the master config. Images are
pinned to the three release manifest SHA-256 digests, not mutable tags. Compose
has **no build stanzas** and retains the original isolation settings.

Directories/ZIPs use private permissions; macOS credentials files use mode 600.
Windows extraction does not preserve POSIX permissions: keep folders under the
assigned user's account with appropriate Windows access controls.
**These ZIPs contain credentials. Transfer them privately, never via public
release attachments or Git.** The generator refuses to replace an existing output
folder. To upgrade images without changing the private API/team configuration,
select a matching public release version explicitly (for example, the prompt-only
UI in `v0.1.1`):

```sh
gh release download v0.1.1 --repo gitDew/smash-bots-image --pattern release.json --dir release-out/v0.1.1
make bundles RELEASE_VERSION=v0.1.1 RELEASE_FILE=release-out/v0.1.1/release.json
```

The version override still requires digest-pinned metadata for the expected image
namespace. It changes only the selected image release/output folder, not credentials.
The new folders go to `bundles/v0.1.1/`; run `stop` in the old team folder before
launching the new one. The same per-team Docker volumes preserve drafts/commits.
To regenerate an existing version separately, use a new `--output` directory:

```sh
node scripts/bundles.mjs generate --config .env.event --release release.json --output bundles/reconfigured
```

### 4. Prepare and launch the laptops yourself

Install/start Docker Desktop first. Windows uses WSL2/Linux containers; allow
for administrator approval/reboots during preparation. No Git, Pi, Node, Python,
Make, or repository checkout is required on the team laptops.

Copy the corresponding private folder to each laptop. In a terminal in that folder:

**Windows Intel — one-time preparation:**

```powershell
.\\launch.ps1 -Action setup
```

**Apple Silicon — one-time preparation:**

```sh
sh launch.sh setup
```

Setup downloads all three digest-pinned images and checks that the fixed team
broker can initialize its private repository. It checks Docker/Compose version
and refuses the wrong CPU/container architecture. It does not silently change
Windows execution policy or start/install Docker; follow your IT policy if scripts
are blocked. Compose 2.30+ is required for literal raw credential loading.

**Launch during the event (no further downloads/builds):**

```powershell
.\\launch.ps1
```

or on the Mac:

```sh
sh launch.sh
```

Run `-Action stop` / `sh launch.sh stop` to stop services while **keeping drafts
and unpushed commits**. `logs` and `check` actions are also available. Perform a
live behavior prompt and successful GitHub submission on **every laptop** before
giving it to a team. Hosted model/GitHub connectivity is still required.

## Development / manual source-based laptop setup

For development only; event laptops should use the bundles above.

Prerequisites: Docker Engine/Desktop running, Docker Compose **2.30+**, and a
terminal. Linux/Windows/macOS are supported by the launchers; image architecture
support still needs testing on the actual event laptops.

1. Create four GitHub repositories, one per team. Use `bot.py` **at repository
   root**. A completely empty repository is supported: the first submission adds
   the included starter bot. An initialized repository must have the configured
   branch (`main` by default). Other files are preserved, never checked out.
2. Make one fine-grained, expiring token per team, scoped to that repository with
   **Contents: read/write**. Do not grant administrator/workflow/organization access.
3. Create `.env` from [`.env.example`](.env.example), or add the missing variables
   to your existing `.env` without overwriting its key:

   ```sh
   cp .env.example .env
   chmod 600 .env
   ```

   Set `TEAM_ID`, `TEAM_REPO_URL`, `GITHUB_TOKEN`, and the model key. Secrets are
   passed only to the broker at runtime; `.env*` is excluded from Docker's build
   context and Git. Use plain `KEY=value` lines. The broker's raw env-file loader
   preserves `$` characters rather than treating keys as interpolation commands.
4. Build the shared image set, once (no real keys needed):

   ```sh
   make build
   ```

   Without Make:

   ```sh
   ENV_FILE=.env.example docker compose --env-file .env.example build
   ```

   In PowerShell:

   ```powershell
   $env:ENV_FILE = '.env.example'
   docker compose --env-file .env.example build
   Remove-Item Env:ENV_FILE
   ```

   Downloads happen during build only. Pi/npm dependencies are locked in
   `package-lock.json`; Python dependencies are version/hash locked in
   `validator/requirements.txt`. The Markdown docs and starter bot are vendored,
   so building does not require the arena repository alongside this one.
5. Launch the assigned team:

   ```sh
   ./scripts/team.sh team_a
   # or: make run TEAM=team_a
   ```

   Windows PowerShell:

   ```powershell
   .\scripts\team.ps1 -Team team_a
   ```

   The launcher verifies that its team matches `TEAM_ID` in the env file. The
   broker initializes the private bare repository, then the child-facing UI opens.

A hosted model and GitHub pushes still require connectivity. “Offline” means
**no general internet access for Pi tools or generated Python**, not that a hosted
LLM works without a network. Supported providers: OpenCode Go (the existing
`OPENCODE_API_KEY` setup), OpenCode Zen, Anthropic, OpenAI, OpenRouter, and Azure
OpenAI v1 Chat Completions. Non-Azure model IDs must exist in Pi 0.84.4's bundled
catalog. For Azure, `LLM_MODEL` is the exact deployment name and
`AZURE_OPENAI_BASE_URL` is the validated v1 endpoint; see
[`config/AZURE.md`](config/AZURE.md). Unsupported configurations fail at startup
rather than downloading new configuration or switching providers.

### Four teams on one machine / shared setup

Use separate env files and Compose projects; never share state/job volumes:

```sh
./scripts/team.sh team_a .env.team_a
./scripts/team.sh team_b .env.team_b
./scripts/team.sh team_c .env.team_c
./scripts/team.sh team_d .env.team_d
```

PowerShell accepts `-EnvFile .env.team_b`. Make accepts
`TEAM=team_b ENV_FILE=.env.team_b`. Each file needs the corresponding `TEAM_ID`
and repository. State volumes record team/repository/branch identity and refuse
reuse with a different assignment. The same image set can be preloaded on all
laptops; the image contains no team assignment or credentials.

## Verification and recovery

Bots implement the same interface as the current arena:

```python
class Bot:
    def __init__(self, port: int): ...
    def get_character(self) -> melee.Character: ...
    def act(self, gamestate, controller) -> None: ...
```

Checks cover Python syntax, allowed offline imports/operations, constructor and
methods, selectable characters (including Sheik), controller argument types/ranges,
read-only game state, and **9,360 synthetic frames** across ports 1–4, 2–4 players,
six stages, recovery, ledges, hitstun, projectiles, and missing/eliminated players.
No actual match is played. Bots are limited to **32 KiB / 2000 lines**.

A validation error blocks publication and is returned to Pi for repair. If the
validator is missing/crashes/times out, submission fails closed: there is **no
fallback that runs bot code in the broker or on the laptop**.

- Drafts and unpushed commits live in the per-team `state` named volume.
- Chat is deliberately in-memory/ephemeral; restart and Pi can read the saved draft.
- After a failed push, ask in ordinary language, e.g. "Please try sending my bot
  again." The agent retries with its tool; an already-published commit is not duplicated.
- External changes to the remote branch are rejected, not merged/overwritten.
  An organizer must reconcile them; keep/back up the old volume before resetting it.
- Cancellation after a submit request has reached the broker may still finish the
  validated publish. It is not a rollback; read the result/check the remote if unsure.
- `make down TEAM=team_a` stops services and **keeps volumes**. Do not use
  `down --volumes` until drafts/unpushed commits are backed up or no longer needed.

Organizer diagnostics:

```sh
make check-config     # quiet; does not print credentials
make logs            # broker/validator status, not child tool output
make down
```

Do not share full `docker compose config`, `docker inspect`, or env files: Docker
administrators can see runtime credentials. Use quota-limited model credentials,
revoke GitHub/model keys after the event, and remove local env files and unused
volumes. Children should not put personal information into prompts sent to a model.

## Development / tests

```sh
npm ci --ignore-scripts
npm test
python3 -m venv .venv
.venv/bin/python3 -m pip install --require-hashes -r validator/requirements.txt
.venv/bin/python3 -m unittest discover -s tests -p 'test_*.py'
```

The unit tests use trusted fixtures, local temporary Git repositories, and fake
model SSE responses; no real keys/public API calls are needed. They exercise
restricted SDK registration, literal prompt handling, provider proxying, exact
snapshot validation, single-file commits, conflicts, retry/restart behavior, and
secret-free results.

With Docker running, build then run:

```sh
make build
make smoke
```

Container smoke tests exercise the actual network-disabled validator, UID and
filesystem isolation, child process/network restrictions, invalid/looping bots,
and the UI container's blocked external egress. CI runs both suites and builds
all three targets. The bundle tests verify token separation, private permissions,
literal `$`/`#` handling, architecture assignments, digest pins, and fail-closed
packaging. Release CI tests both CPU architectures natively: on Apple Silicon,
Rosetta's address mappings can fail under the Python address-space limit, so a
local emulated Intel smoke test is not a substitute for native Intel CI. Do not
weaken the validator limits to make emulation pass.

Before the event, also perform a **live model prompt and test
submission on every laptop**; unit tests/fake SSE do not validate live credentials,
provider quota, GitHub permissions, terminal behavior, or architecture support.

Sources: [`config/AGENTS.md`](config/AGENTS.md) (baked instructions),
[`docs/libmelee/`](docs/libmelee/README.md) (offline reference),
[`templates/bot.py`](templates/bot.py) (starter). libmelee is LGPL-3.0; its supplied
license is retained in `docs/libmelee/LICENSE.LGPL-3.txt` and in the Python package;
the incorporated GPL-3 terms are also retained in `docs/libmelee/LICENSE.GPL-3.txt`.
Review third-party license/source distribution requirements before publishing an
event image. Pin/test base-image digests and a versioned `IMAGE_TAG` for release;
`dev` and mutable base-image tags are for development, not the final event release.
