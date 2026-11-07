# syntax=docker/dockerfile:1

# Versions of Pi and its transitive dependencies are pinned in package-lock.json.
FROM node:22-bookworm-slim AS node-build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY app ./app
RUN npm run build \
    && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

# Build any Python C extensions here, not in the runtime validator. Downloads
# occur at image build time only; Python dependencies are version/hash pinned.
FROM python:3.11-slim-bookworm AS python-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY validator/requirements.txt /tmp/requirements.txt
RUN python3 -m pip wheel --no-cache-dir --no-deps --require-hashes \
    --wheel-dir=/wheels -r /tmp/requirements.txt

FROM python:3.11-slim-bookworm AS validator
COPY --from=python-build /wheels /wheels
RUN python3 -m pip install --no-cache-dir --no-index --no-deps /wheels/*.whl \
    && rm -rf /wheels \
    && mkdir -p /jobs \
    && chown 1000:1000 /jobs \
    && chmod 0770 /jobs
COPY validator/policy.py validator/run_bot.py validator/worker.py /opt/smash/validator/
WORKDIR /opt/smash/validator
USER 0:1000
ENTRYPOINT ["python3", "-I", "-B", "/opt/smash/validator/worker.py"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PI_OFFLINE=1 \
    PI_TELEMETRY=0 \
    PI_SKIP_VERSION_CHECK=1
WORKDIR /opt/smash
COPY --from=node-build /build/node_modules ./node_modules
COPY --from=node-build /build/dist ./dist
COPY package.json ./
COPY config/AGENTS.md ./AGENTS.md
COPY docs/libmelee ./docs/libmelee
COPY templates ./templates
# The real pinned Pi CLI is installed for administrator diagnostics. Kids launch
# the fixed SDK UI below instead: the CLI's general tools/commands are not exposed.
RUN ln -s /opt/smash/node_modules/@earendil-works/pi-coding-agent/dist/cli.js /usr/local/bin/pi

FROM runtime AS broker
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /state /jobs /opt/smash/no-hooks \
    && chown 1000:1000 /state /jobs \
    && chmod 0770 /state /jobs
COPY --chmod=0555 git-askpass.sh ./git-askpass.sh
USER 1000:1000
ENTRYPOINT ["node", "/opt/smash/dist/broker.js"]

# Default build target: the restricted kid-facing Pi UI, with no Git or Python.
FROM runtime AS agent
USER 1000:1000
ENTRYPOINT ["node", "/opt/smash/dist/agent.js"]
