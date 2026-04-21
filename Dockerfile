# TradeQuote production image.
#
# Switched from nixpacks.toml to an explicit Dockerfile because Nixpacks
# v1.41 was silently dropping all but the first entry of `aptPkgs` — the
# Chromium runtime libs needed by @sparticuz/chromium never made it into
# the image, so Puppeteer would have failed to launch on the first PDF
# request. With a Dockerfile we control apt exactly.

FROM node:20-bullseye-slim

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
COPY . .
RUN npm run build

# Railway provides PORT at runtime; server.js reads process.env.PORT
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
