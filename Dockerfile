FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY tsconfig.json ./
COPY tsconfig.build.json ./
COPY src ./src
RUN pnpm run build

FROM base AS runtime

ENV NODE_ENV=production
ENV FACADE_HOST=0.0.0.0
ENV CALLBACK_HOST=0.0.0.0
ENV OPENCODE_HOST=host.docker.internal

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/build ./build

EXPOSE 3120 3118

CMD ["node", "build/index.js"]
