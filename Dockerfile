# FastQuote production image.
#
# Switched from nixpacks.toml to an explicit Dockerfile because Nixpacks
# v1.41 was silently dropping all but the first entry of `aptPkgs` — the
# Chromium runtime libs needed by @sparticuz/chromium never made it into
# the image, so Puppeteer would have failed to launch on the first PDF
# request. With a Dockerfile we control apt exactly.
#
# Base bumped bullseye -> bookworm (2026-09-19). Debian 11 (bullseye)'s
# security repo has moved off deb.debian.org onto archive.debian.org as
# packages age out of support, which surfaced as `apt-get install`
# 404-ing on half the Chromium runtime libs mid-build (discovered via a
# diagnostic parallel Railway service that landed on a healthy build
# node and actually got far enough to hit the real error, instead of
# the primary service's stuck-builder symptom masking it). Bookworm
# (Debian 12) is still in full security support, keeps the exact same
# apt package names as bullseye for every lib below (the libFOOt64
# rename only lands in trixie/13), and @sparticuz/chromium 147.x is
# built against a glibc baseline bookworm satisfies comfortably.
FROM node:20-bookworm-slim

# Runtime shared libs + fonts that Chromium (bundled by @sparticuz/chromium)
# needs to launch headless. ffmpeg stays for the video processing pipeline.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
      ffmpeg \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxshmfence1 \
      fonts-liberation \
      fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so the layer caches across source changes
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Then the rest of the app + build
# BUILD_DATE busts the layer cache when Railway's cache gets stuck
ARG BUILD_DATE
COPY . .
RUN npm run build

# Railway provides PORT at runtime; server.js reads process.env.PORT
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
