FROM node:22-alpine AS builder

RUN npm install -g pnpm@9.15.4

WORKDIR /app

# Copy workspace config (cached layer -- only changes when deps change)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy all package.json files
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/api/package.json packages/api/
# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/engine/ packages/engine/
COPY packages/api/ packages/api/

# Build shared, engine, api only
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN pnpm --filter @fluxure/shared --filter @fluxure/engine --filter @fluxure/api build

# --- Production image ---
FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy pnpm from builder instead of reinstalling
COPY --from=builder /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm
RUN ln -s /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm

WORKDIR /app

COPY --chown=appuser:appgroup package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY --chown=appuser:appgroup packages/shared/package.json packages/shared/
COPY --chown=appuser:appgroup packages/engine/package.json packages/engine/
COPY --chown=appuser:appgroup packages/api/package.json packages/api/

RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    pnpm rebuild bcrypt && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy built artifacts
COPY --chown=appuser:appgroup --from=builder /app/packages/shared/dist packages/shared/dist
COPY --chown=appuser:appgroup --from=builder /app/packages/engine/dist packages/engine/dist
COPY --chown=appuser:appgroup --from=builder /app/packages/api/dist packages/api/dist

EXPOSE 3000

ENV NODE_ENV=production

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "packages/api/dist/index.js"]
