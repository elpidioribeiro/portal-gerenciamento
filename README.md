# Portal GD — Gerenciamento Diário

Aplicação web para **Gerenciamento Diário (GD)** no modelo Lean: o time acompanha,
todo dia, os poucos indicadores que importam (verde/vermelho) e transforma cada
desvio em uma **contramedida** com dono e prazo, subindo pela cadeia de ajuda
quando não se resolve no próprio nível.

> ⚠️ **Versão de portfólio, derivada de um projeto real.** Nomes de empresa,
> domínios, logos, IPs, filiais e dados específicos foram substituídos por
> exemplos genéricos. A estrutura e a lógica do código são as mesmas do original.

---

## O problema que resolve

Dois problemas crônicos de gestão operacional:

1. **Desvios só aparecem quando o estrago já foi feito** — o dado do dia chega
   tarde, em planilha, longe de quem pode agir.
2. **A estratégia não desce até a ponta** — metas são definidas em cima e nunca
   viram ação concreta no chão da operação.

O Portal GD aproxima a decisão do lugar e do momento do desvio: um quadro
digital que mostra o real contra o esperado e organiza a solução de problemas.

## Como funciona

O ciclo do GD é modelado no domínio da aplicação:

```
Indicador  →  Variável de controle  →  Ponto de causa  →  Contramedida
 (o quê)         (o que controla)         (a raiz)         (a ação, com dono e prazo)
```

E a hierarquia da reunião, com escalação:

```
N4 (área)  →  N3 (gerência)  →  N2 (quadro)        + CROSS (apoio)
   quem está mais perto do trabalho ────────► quem está mais perto da estratégia
```

Arquitetura em alto nível:

```
  Navegador (SPA React)
        │  /api
        ▼
  Backend (Fastify + Prisma)  ──►  PostgreSQL   (dados do portal: indicadores,
        │                                         variáveis, contramedidas, metas)
        ├──►  API de login corporativa            (valida a credencial)
        ├──►  Oracle (somente leitura)            (perfil/nível e cadastro de RH)
        └──►  Ingestão (webhook)  ◄──  ETL/n8n    (vendas, NPS, perdas, movimentação)
```

- **Autenticação** delegada a uma API de login corporativa; o **nível e o escopo
  de dados** de cada pessoa vêm de uma consulta de leitura no Oracle, pela
  matrícula. O portal emite a própria sessão (cookie httpOnly, JWT próprio).
- **Autorização por nível** (N4/N3/N2/CROSS) resolvida a cada requisição, mais um
  papel de administração e a regra de "quem recebe ação".
- **Ingestão** dos fatos (vendas, NPS, perdas, movimentação) e das metas por um
  endpoint protegido, alimentado por um orquestrador externo.
- **Quadro** por nível com farol verde/vermelho, drill-down até o ponto de causa
  (Pareto) e abertura/escalonamento de contramedidas.

## Stack

**Backend**
- Node + TypeScript (strict)
- Fastify 5 · Prisma 6 · PostgreSQL
- Zod (validação de env e de contratos de API)
- `node-oracledb` (leitura direta no Oracle, modo Thin)
- Vitest (testes de unidade e integração)

**Frontend**
- React 18 · Vite 6 · TypeScript
- Tailwind CSS 3
- TanStack Query 5 · React Router 7

**Infra / build**
- Docker (imagem do backend multi-stage; Postgres local via Docker Compose)
- Pipeline de CI (lint, tipos, testes, build) — genérica neste repositório

## Como rodar localmente

Pré-requisitos: **Node 20+** e **Docker**.

```bash
# 1) Banco local (Postgres) via Docker
docker compose up -d

# 2) Backend
cd backend
cp .env.example .env          # ajuste o que precisar; o padrão já roda local
npm install
npx prisma migrate deploy     # cria o schema
npm run db:seed               # popula dados de exemplo + usuários de teste
npm run dev                   # backend em http://localhost:3001

# 3) Frontend (em outro terminal)
cd frontend
npm install
npm run dev                   # tela em http://localhost:5173
```

Autenticação em desenvolvimento: com `AUTH_PROVIDER=mock` (padrão do `.env.example`),
o login valida contra usuários semeados no banco — não é preciso a API
corporativa. Para exercitar o fluxo real, use `AUTH_PROVIDER=erp` e as variáveis
de Oracle/login.

## Estrutura de pastas

```
backend/
  src/
    modules/        # auth, painel, contramedidas, indicadores, ingestão, admin...
    fontes/         # consultas SQL e mapeamento das fontes de ingestão
    config/         # validação de env, plugins (auth, prisma, agenda)
    lib/            # oracle, erros, utilidades
  prisma/           # schema, migrations e seed
  tests/            # unit + integration (Vitest)
  scripts/          # tarefas de operação (seed de usuários, recarga, etc.)
frontend/
  src/
    routes/         # telas (login, reuniões N4/N3/N2, ações, admin)
    components/     # componentes de painel, ações, layout, admin
    lib/            # cliente de API, formatação, tipos
    contexts/       # sessão
chart/              # chart Helm (deploy em Kubernetes) — genérico
docker-compose.yml  # Postgres local
```

## Licença

MIT — veja [LICENSE](LICENSE).
