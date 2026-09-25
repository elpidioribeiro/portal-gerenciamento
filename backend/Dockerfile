# Portal GD — backend.
#
# Contexto de build: a pasta `backend/`. Isso passou a ser possível em 22/08/2026,
# quando `fontes.mjs` e as consultas `.sql` saíram de `docs/n8n/` para
# `src/fontes/` — antes o `dist/` importava `../../../../docs/n8n/`, quatro
# níveis acima, e uma imagem com só o backend não subia.
#
# Multi-stage: o estágio final não leva TypeScript, ESLint, vitest nem o código
# fonte. Leva `dist/`, as dependências de produção e o client do Prisma.
#
# SEM Oracle Instant Client. O `node-oracledb` 6+ tem modo Thin, JavaScript puro
# — a imagem segue alpine limpa, sem binário nativo e sem a licença do client da
# Oracle.

# ── Dependências ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# `npm ci`, não `npm install`: instala exatamente o que o lock manda. `install`
# pode resolver versões diferentes das testadas, e uma imagem que difere do que
# passou no CI é a definição de deploy não reprodutível.
COPY package.json package-lock.json ./
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

# O client do Prisma é gerado ANTES do tsc: o código importa tipos de
# `@prisma/client`, e sem gerar eles não existem.
RUN npx prisma generate

# `npm run build` = tsc + copiar-assets. O segundo passo leva `src/fontes/`
# (o `.mjs` e os `.sql`) para `dist/fontes/` — o tsc não os emite, e sem eles o
# boot morre com ERR_MODULE_NOT_FOUND.
RUN npm run build

# Descarta o que era só para compilar. `--omit=dev` sobre o `node_modules` já
# instalado é mais rápido que reinstalar, e mantém a mesma resolução do lock.
RUN npm prune --omit=dev

# ── Imagem final ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# O COMMIT QUE ESTA' RODANDO, para a rota /version.
#
# O CI passa `--build-arg APP_VERSION=$CI_COMMIT_SHORT_SHA`; a rota le' de
# `process.env.APP_VERSION`. Sem o build-arg (build local), fica "dev" -- a
# rota diz isso em vez de mentir um commit.
#
# ARG no estagio runtime de proposito: mudar so' o SHA nao invalida o cache das
# camadas de dependencia e build acima, entao rebuild por commit e' barato.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# `dumb-init` como PID 1: sem ele o Node não recebe SIGTERM direito e o
# encerramento gracioso (que fecha o pool do Oracle e o do Postgres) não roda —
# o orquestrador espera o timeout e mata o processo.
RUN apk add --no-cache dumb-init

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# `prisma/` e o `prisma.config.ts` entram para o passo de migration, que roda
# SEPARADO do CMD — nunca no start da aplicação. Com mais de uma réplica,
# migrar no boot faz as réplicas correrem umas contra as outras.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

# Usuário não-root. A imagem `node` já traz `node` (uid 1000); usá-lo evita
# criar outro e é o que o restante do ecossistema espera.
USER node

EXPOSE 3001

# O healthcheck bate no mesmo `/health` que o orquestrador usa. `--spider` não
# existe no wget do busybox; `-q -O -` é o equivalente.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
