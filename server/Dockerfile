# syntax=docker/dockerfile:1
# ---- build ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# Schema + config first: `npm ci` runs `prisma generate` (postinstall) into src/generated
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx prisma generate && npx tsc -p tsconfig.build.json

# ---- runtime ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# Production deps only (prisma CLI is a runtime dependency for `migrate deploy`). Install scripts must run:
# @prisma/engines downloads the schema engine here, as root — at start the app runs as `node` and
# could not write it into node_modules. (Our postinstall `prisma generate` also runs; harmless.)
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 5000
# Local CLI only (never fetch another version); `exec` makes node PID 1 so SIGTERM reaches it
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/src/index.js"]
