# Portal GD — frontend.
#
# Duas etapas: o Vite gera `dist/`, o nginx serve. A imagem final não leva Node,
# nem `node_modules`, nem código-fonte — leva arquivos estáticos e um nginx.
#
# POR QUE NGINX E NÃO O PRÓPRIO FASTIFY servindo o `dist/`: o cliente chama
# `/api/v1` na MESMA ORIGEM (ver `lib/api.ts`), porque o cookie de sessão é
# `sameSite: strict` e precisa ser same-origin. Isso obriga portal e API a
# responderem no mesmo host. As duas saídas eram servir os estáticos pelo
# backend, ou pôr um proxy na frente. Escolhido o proxy: o backend continua
# sendo só API, e a tela escala e reinicia sem mexer em quem guarda a sessão.

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# `npm ci`, não `npm install`: instala exatamente o que o lock manda. Uma
# imagem que difere do que passou no CI é a definição de deploy não
# reprodutível.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts tailwind.config.ts postcss.config.js index.html ./
COPY public ./public
COPY src ./src
# `tests/` ENTRA, e não é descuido: o `include` do `tsconfig.json` é
# `["src", "tests", "vite.config.ts", "tailwind.config.ts"]`. Sem eles o
# `tsc -b` checaria um projeto DIFERENTE do que o CI checa -- e foi o que
# aconteceu na primeira versão deste arquivo: o build quebrou em
# `vite.config.ts` com "'test' does not exist in type 'UserConfigExport'",
# porque a augmentação de tipo do vitest vinha pelos testes.
#
# Eles ficam só nesta etapa; a imagem final leva o `dist/` e mais nada.
COPY tests ./tests

# `npm run build` = `tsc -b && vite build`. O `tsc` entra de propósito: erro de
# tipo derruba o build aqui, e não vira tela branca em produção.
RUN npm run build

# ── Imagem final ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
# COMO TEMPLATE, e não como `conf.d/default.conf` pronto.
#
# O entrypoint da imagem nginx passa `envsubst` em tudo que está em
# `/etc/nginx/templates/` e escreve o resultado em `conf.d/`. É o que preenche
# o resolver do cluster e o nome do Service do backend no arranque, sem script
# próprio. Ver os `${...}` no arquivo.
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Padrões para o cluster; o chart sobrescreve os dois pelo bloco `env` do
# `deployment.yaml`. Num `docker run` avulso, passe `-e DNS_RESOLVER=127.0.0.11`,
# que é o DNS embutido do Docker.
#
# ATÉ 15/09/2026 ESTA AFIRMAÇÃO ERA FALSA: o `deployment.yaml` não tinha bloco
# `env` nenhum, e `backend.servico` no `values.yaml` não era lido por nada. Os
# dois padrões abaixo eram o endereço REAL em produção, e mudar o chart não
# mudava coisa alguma -- sem erro, só 502 em `/api`.
ENV BACKEND_SERVICO=portal-gd-backend
ENV DNS_RESOLVER=kube-dns.kube-system.svc.cluster.local

# A imagem `nginx` já traz o usuário `nginx`, e rodar como ele exige entregar o
# dono de tudo o que o processo escreve.
#
# `conf.d` É O QUE MAIS IMPORTA AQUI, e foi o que faltou na primeira tentativa:
# é ali que o entrypoint ESCREVE o resultado do template. Sem o dono certo ele
# desiste com `ERROR: /etc/nginx/templates exists, but /etc/nginx/conf.d is not
# writable` — e o nginx sobe assim mesmo, com o `default.conf` da imagem
# original. O contêiner fica de pé servindo a página de boas-vindas do nginx na
# porta 80, e nada na tela diz que a configuração do portal não foi aplicada.
RUN touch /var/run/nginx.pid \
  && chown -R nginx:nginx \
    /var/run/nginx.pid \
    /usr/share/nginx/html \
    /var/cache/nginx \
    /etc/nginx/conf.d

USER nginx

EXPOSE 8080

# O healthcheck bate no mesmo `/healthz` que o Kubernetes usa. `--spider` não
# existe no wget do busybox; `-q -O -` é o equivalente.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
