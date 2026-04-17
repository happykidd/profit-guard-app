FROM node:22-alpine

RUN apk add --no-cache openssl libc6-compat

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/db/package.json ./packages/db/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm db:generate
RUN pnpm --filter @profit-guard/web build

ENV NODE_ENV=production

EXPOSE 10000

CMD ["pnpm", "--filter", "@profit-guard/web", "start"]

