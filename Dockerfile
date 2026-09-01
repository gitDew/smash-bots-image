# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
    && rm -rf /var/lib/apt/lists/*

# Keep the Pi version explicit so a rebuild does not silently change the
# coding-agent version.
ARG PI_VERSION=0.84.4
RUN npm install --global --ignore-scripts \
    "@earendil-works/pi-coding-agent@${PI_VERSION}" \
    && npm cache clean --force

WORKDIR /workspace

# Pi is interactive, so run the container with: docker run --rm -it <image>
CMD ["pi"]
