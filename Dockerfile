# MESA Events Platform – standalone Next.js on Node (no Vercel features).
# NEXT_PUBLIC_* values are baked in at build time:
#   docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... -t mesa-events .
# A staging image (docs/STAGING.md) adds --build-arg NEXT_PUBLIC_APP_ENV=staging;
# `--target tools` is the source with all dependencies, for the seed scripts.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN=esnmesa.org
ARG NEXT_PUBLIC_APP_ENV=production
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN=$NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN \
    NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# The seed scripts (npm run staging:reset -- --remote) with the whole source
# tree and all dependencies; never deployed as the app.
FROM build AS tools
ENV NODE_ENV=development
CMD ["node", "--version"]

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/legal ./legal
COPY --from=build --chown=app:app /app/tools/esn-activities ./tools/esn-activities
USER app
EXPOSE 3000
CMD ["node", "server.js"]
