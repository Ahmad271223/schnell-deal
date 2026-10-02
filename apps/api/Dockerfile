# syntax=docker/dockerfile:1.7
# API + Worker (gleiches Image, unterschiedlicher Startbefehl)
FROM node:24-alpine AS base
RUN corepack enable && apk add --no-cache tini
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @sd/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @sd/api build \
 && pnpm --filter @sd/api deploy --legacy --prod /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/drizzle /out/drizzle

FROM base AS runtime
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/drizzle \
    PORT=4000
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
