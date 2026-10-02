# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG API_INTERNAL_URL=http://api:4000
# Herkunft der Signed URLs (Objektspeicher) für die Content-Security-Policy, z. B. https://storage.auktion.example.de.
# Muss beim Build gesetzt sein (compose: CSP_STORAGE_ORIGIN in der .env); sonst blockiert der Browser später Fotos und Videos.
ARG CSP_STORAGE_ORIGIN=
RUN test -n "$CSP_STORAGE_ORIGIN" || { echo "CSP_STORAGE_ORIGIN fehlt (öffentliche Adresse des Objektspeichers, = S3_PUBLIC_ENDPOINT)" >&2; exit 1; }
RUN case "$CSP_STORAGE_ORIGIN" in http://*|https://*) ;; *) echo "CSP_STORAGE_ORIGIN muss mit http:// oder https:// beginnen: $CSP_STORAGE_ORIGIN" >&2; exit 1;; esac
ENV BUILD_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    API_INTERNAL_URL=${API_INTERNAL_URL} \
    CSP_STORAGE_ORIGIN=${CSP_STORAGE_ORIGIN}
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @sd/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
# NEXT_PUBLIC_WS_URL bleibt leer: der Browser verbindet sich same-origin (wss://<host>/api/v1/ws über den Reverse-Proxy).
RUN pnpm --filter @sd/web build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
