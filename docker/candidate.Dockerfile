FROM node:22-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.26.0 --activate

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @prelude/db db:generate

EXPOSE 3001

CMD ["pnpm", "--filter", "@prelude/candidate", "exec", "next", "dev", "--hostname", "0.0.0.0", "--port", "3001"]
