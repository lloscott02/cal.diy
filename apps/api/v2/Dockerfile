# Cal Zero API v2 - Railway Dockerfile
# Multi-stage build for production deployment

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20-alpine AS build

ARG DATABASE_DIRECT_URL
ARG DATABASE_URL

WORKDIR /calcom

# Install system dependencies
RUN set -eux; \
    apk add --no-cache openssl; \
    ln -s /usr/lib/libssl.so.3 /lib/libssl.so.3

ENV NODE_ENV="production"
ENV NODE_OPTIONS="--max-old-space-size=8192"
ENV DATABASE_DIRECT_URL=${DATABASE_DIRECT_URL}
ENV DATABASE_URL=${DATABASE_URL}
ENV USE_POOL="true"

# Copy source and install dependencies
COPY . .
RUN yarn install

# Generate Prisma client and build
RUN yarn workspace @calcom/api-v2 run generate-schemas
RUN yarn workspace @calcom/api-v2 run build:docker
RUN yarn workspace @calcom/api-v2 run build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:20-alpine AS production

WORKDIR /calcom

# Install runtime dependencies
RUN apk add --no-cache openssl wget && \
    ln -s /usr/lib/libssl.so.3 /lib/libssl.so.3

# Copy built application from build stage
COPY --from=build /calcom/node_modules ./node_modules
COPY --from=build /calcom/packages ./packages
COPY --from=build /calcom/apps/api/v2/dist ./apps/api/v2/dist
COPY --from=build /calcom/apps/api/v2/package.json ./apps/api/v2/

ENV NODE_ENV=production

# Railway dynamically assigns PORT - no need to set it here
# The app reads PORT env var at runtime (config/app.ts)

# Health check for Railway (uses $PORT at runtime)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-8080}/health || exit 1

CMD ["node", "./apps/api/v2/dist/apps/api/v2/src/main.js"]
