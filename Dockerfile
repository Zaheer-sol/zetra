# One image definition, three targets: api, worker, web.
#   docker build --target api    -t zetra-api .
#   docker build --target worker -t zetra-worker .
#   docker build --target web    -t zetra-web .

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY backend/worker/package.json backend/worker/
COPY frontend/package.json frontend/
# Manifests only, so this layer (and npm ci) is cached until dependencies change.
COPY backend/packages/blockchain/package.json backend/packages/blockchain/
COPY backend/packages/config/package.json backend/packages/config/
COPY backend/packages/database/package.json backend/packages/database/
COPY backend/packages/engine/package.json backend/packages/engine/
COPY backend/packages/events/package.json backend/packages/events/
COPY backend/packages/matching/package.json backend/packages/matching/
COPY backend/packages/schemas/package.json backend/packages/schemas/
COPY backend/packages/sdk/package.json backend/packages/sdk/
COPY backend/packages/security/package.json backend/packages/security/
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN node scripts/build-service.mjs backend/src/main.ts backend/dist/main.js \
 && node scripts/build-service.mjs backend/worker/src/main.ts backend/worker/dist/main.js \
 && node scripts/build-service.mjs backend/packages/database/src/migrate.ts backend/packages/database/dist/migrate.js
RUN npm run build -w @zetra/web

FROM node:22-bookworm-slim AS runtime-base
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --system --uid 1001 zetra
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

FROM runtime-base AS api
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/packages/database/dist/migrate.js ./dist/migrate.js
COPY --from=build /app/backend/packages/database/migrations ./migrations
USER zetra
EXPOSE 4000
CMD ["node", "dist/main.js"]

FROM runtime-base AS worker
COPY --from=build /app/backend/worker/dist ./dist
USER zetra
CMD ["node", "dist/main.js"]

FROM runtime-base AS web
WORKDIR /app/frontend
COPY --from=build /app/frontend/.next ./.next
COPY --from=build /app/frontend/public ./public
COPY --from=build /app/frontend/package.json ./package.json
COPY --from=build /app/frontend/next.config.ts ./next.config.ts
COPY --from=build /app/backend/packages/schemas /app/backend/packages/schemas
USER zetra
EXPOSE 3000
CMD ["node", "/app/node_modules/next/dist/bin/next", "start", "--port", "3000"]
