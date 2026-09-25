import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { FALTANTES_TABELA, FALTANTES_COLUNA } from './gmud-comentarios-faltantes.js'

/**
 * Gera o script de CRIAÇÃO DO BANCO DE PRODUÇÃO, no padrão AcmeLabs.
 *
 * Os scripts 1 a 7 da pasta `docs/gmud/` ALTERAM o banco de desenvolvimento —
 * renomeiam objetos, criam índices, acrescentam comentários. Nenhum deles cria
 * o schema do zero, e é isso que o DBA precisa: produção nasce vazia.
 *
 * **Lido do banco vivo, e não do `schema.prisma`.** O banco de desenvolvimento
 * já passou pelos scripts 1 a 7 e é a única fonte que conhece o estado REAL —
 * os nomes adequados ao padrão, os índices acrescentados à mão, os comentários
 * aplicados. Gerar do Prisma produziria os nomes que o Prisma inventa
 * (`_pkey`), que é exatamente o que o script 1 existiu para corrigir.
 *
 * **Gerador e não SQL à mão**, pela mesma razão do script 1: são 35 tabelas,
 * 285 colunas e cerca de 330 objetos. O erro aqui não aparece em teste —
 * aparece na GMUD devolvida, ou num banco de produção diferente do de
 * desenvolvimento.
 *
 * Uso: npx tsx --env-file=.env scripts/gerar-gmud-criacao.ts
 */

const DESTINO = path.resolve(import.meta.dirname, '..', '..', 'docs', 'gmud')
const ESQUEMA = 'public'
const SEQUENCIAL = '8'
const NOME = 'cria_banco_portal_gd'

/**
 * O que NÃO vai para produção.
 *
 * `_prisma_migrations` é a tabela de controle do PRÓPRIO Prisma. Ela não faz
 * parte do modelo, e mandá-la na GMUD pediria ao DBA para criar uma estrutura
 * de ferramenta. Ver a nota sobre `P3005` no cabeçalho do script gerado: se
 * produção nasce pela GMUD, o Prisma precisa ser avisado disso depois.
 */
const FORA = new Set(['_prisma_migrations'])

const prisma = new PrismaClient()
const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)

/** Aspas simples dobradas: é o único escape que o SQL precisa num literal. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

interface Coluna {
  tabela: string
  coluna: string
  posicao: number
  tipo: string
  obrigatoria: boolean
  padrao: string | null
  comentario: string | null
}

async function principal() {
  // ── O catálogo ─────────────────────────────────────────────────────────────
  const tabelas = (
    await q<{ nome: string; comentario: string | null }>(`
      select c.relname as nome, obj_description(c.oid) as comentario
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = ${lit(ESQUEMA)} and c.relkind = 'r'
       order by c.relname`)
  ).filter((t) => !FORA.has(t.nome))

  const colunas = (
    await q<Coluna>(`
      select c.table_name as tabela, c.column_name as coluna, c.ordinal_position as posicao,
             format_type(a.atttypid, a.atttypmod) as tipo,
             (c.is_nullable = 'NO') as obrigatoria,
             c.column_default as padrao,
             col_description(pc.oid, c.ordinal_position) as comentario
        from information_schema.columns c
        join pg_class pc on pc.relname = c.table_name
        join pg_namespace n on n.oid = pc.relnamespace and n.nspname = ${lit(ESQUEMA)}
        join pg_attribute a on a.attrelid = pc.oid and a.attname = c.column_name
       where c.table_schema = ${lit(ESQUEMA)} and pc.relkind = 'r'
       order by c.table_name, c.ordinal_position`)
  ).filter((c) => !FORA.has(c.tabela))

  const tipos = await q<{ nome: string; valores: string[] }>(`
    select t.typname as nome, array_agg(e.enumlabel order by e.enumsortorder) as valores
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace and n.nspname = ${lit(ESQUEMA)}
     group by t.typname order by t.typname`)

  /*
   * O FILTRO `FORA` VALE PARA TODAS AS CONSULTAS, e esqueci em duas.
   *
   * `tabelas` e `colunas` filtravam; `restricoes` e `indices` nao -- e o script
   * saiu com o cabecalho dizendo "nao ha _prisma_migrations aqui" e um
   * `ADD CONSTRAINT _prisma_migrations_pkey` trinta linhas abaixo. Pego
   * conferindo a contagem: 35 chaves primarias para 34 tabelas.
   */
  const restricoesTodas = await q<{ tabela: string; nome: string; tipo: string; definicao: string }>(`
    select rel.relname as tabela, con.conname as nome, con.contype as tipo,
           pg_get_constraintdef(con.oid) as definicao
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace and n.nspname = ${lit(ESQUEMA)}
     order by rel.relname, array_position(array['p','u','c','f'], con.contype::text), con.conname`)

  const restricoes = restricoesTodas.filter((r) => !FORA.has(r.tabela))

  const indicesTodos = await q<{ tabela: string; nome: string; definicao: string }>(`
    select tablename as tabela, indexname as nome, indexdef as definicao
      from pg_indexes
     where schemaname = ${lit(ESQUEMA)}
     order by tablename, indexname`)

  const indices = indicesTodos.filter((i) => !FORA.has(i.tabela))

  const views = await q<{ nome: string; definicao: string; comentario: string | null }>(`
    select c.relname as nome, pg_get_viewdef(c.oid, true) as definicao,
           obj_description(c.oid) as comentario
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${lit(ESQUEMA)} and c.relkind = 'v'
     order by c.relname`)

  const colsDeView = await q<Coluna>(`
    select c.table_name as tabela, c.column_name as coluna, c.ordinal_position as posicao,
           format_type(a.atttypid, a.atttypmod) as tipo, false as obrigatoria,
           null as padrao, col_description(pc.oid, c.ordinal_position) as comentario
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
      join pg_namespace n on n.oid = pc.relnamespace and n.nspname = ${lit(ESQUEMA)}
      join pg_attribute a on a.attrelid = pc.oid and a.attname = c.column_name
     where c.table_schema = ${lit(ESQUEMA)} and pc.relkind = 'v'
     order by c.table_name, c.ordinal_position`)

  // ── A conferência que impede a GMUD voltar ────────────────────────────────
  /*
   * O padrão (§7) exige COMMENT na tabela e em TODAS as colunas. Um script sem
   * isso é devolvido pelo DBA -- e descobrir na devolução custa uma janela de
   * mudança.
   *
   * O que falta no banco é completado pelo dicionário; o que não estiver em
   * nenhum dos dois DERRUBA o gerador, com a lista. Falhar aqui é barato.
   */
  const comentarioDaTabela = (t: string, atual: string | null) =>
    atual ?? FALTANTES_TABELA[t] ?? null
  const comentarioDaColuna = (t: string, c: string, atual: string | null) =>
    atual ?? FALTANTES_COLUNA[`${t}.${c}`] ?? null

  const semTexto: string[] = []
  for (const t of [...tabelas, ...views]) {
    if (!comentarioDaTabela(t.nome, t.comentario)) semTexto.push(`tabela ${t.nome}`)
  }
  for (const c of [...colunas, ...colsDeView]) {
    if (!comentarioDaColuna(c.tabela, c.coluna, c.comentario)) {
      semTexto.push(`${c.tabela}.${c.coluna}`)
    }
  }
  if (semTexto.length > 0) {
    console.error(
      `\n${String(semTexto.length)} objetos SEM COMMENT. O padrão exige em todos, e a GMUD ` +
        'seria devolvida. Acrescente em scripts/gmud-comentarios-faltantes.ts:\n',
    )
    for (const s of semTexto) console.error('  ', s)
    process.exitCode = 1
    return
  }

  // ── O script ──────────────────────────────────────────────────────────────
  const l: string[] = []
  const secao = (t: string) => {
    l.push('')
    l.push('-- ' + '='.repeat(76))
    l.push(`-- ${t}`)
    l.push('-- ' + '='.repeat(76))
    l.push('')
  }

  l.push(CABECALHO(tabelas.length, colunas.length, tipos.length))

  secao(`Os ${String(tipos.length)} dominios`)
  for (const t of tipos) {
    l.push(
      `CREATE TYPE ${ESQUEMA}.${t.nome} AS ENUM (${t.valores.map((v) => lit(v)).join(', ')});`,
    )
  }

  secao(`As ${String(tabelas.length)} tabelas`)
  for (const t of tabelas) {
    const minhas = colunas.filter((c) => c.tabela === t.nome)
    /*
     * NOT NULL ANTES DE NULL, como o padrão pede (§7). A ordem das colunas não
     * muda comportamento nenhum no Postgres -- é apresentação --, e é por isso
     * que dá para reordenar sem risco. `sort` estável mantém a ordem original
     * dentro de cada grupo.
     */
    const ordenadas = [...minhas].sort(
      (a, b) => Number(b.obrigatoria) - Number(a.obrigatoria) || a.posicao - b.posicao,
    )
    const largura = Math.max(...ordenadas.map((c) => c.coluna.length))
    const larguraTipo = Math.max(...ordenadas.map((c) => c.tipo.length))
    l.push(`CREATE TABLE ${ESQUEMA}.${t.nome} (`)
    l.push(
      ordenadas
        .map((c) => {
          const padrao = c.padrao ? ` DEFAULT ${c.padrao}` : ''
          const nulo = c.obrigatoria ? ' NOT NULL' : ''
          return `  ${c.coluna.padEnd(largura)} ${c.tipo.padEnd(larguraTipo)}${nulo}${padrao}`
        })
        .join(',\n'),
    )
    l.push(');')
    l.push('')
  }

  const daTabela = (tipo: string) => restricoes.filter((r) => r.tipo === tipo)

  secao(`As ${String(daTabela('p').length)} chaves primarias`)
  for (const r of daTabela('p')) {
    l.push(`ALTER TABLE ${ESQUEMA}.${r.tabela} ADD CONSTRAINT ${r.nome} ${r.definicao};`)
  }

  secao(`As ${String(daTabela('u').length)} constraints unique`)
  for (const r of daTabela('u')) {
    l.push(`ALTER TABLE ${ESQUEMA}.${r.tabela} ADD CONSTRAINT ${r.nome} ${r.definicao};`)
  }

  secao(`As ${String(daTabela('c').length)} constraints de check`)
  for (const r of daTabela('c')) {
    l.push(`ALTER TABLE ${ESQUEMA}.${r.tabela} ADD CONSTRAINT ${r.nome} ${r.definicao};`)
  }

  secao(`As ${String(daTabela('f').length)} chaves estrangeiras`)
  l.push('-- Depois de TODAS as tabelas: uma FK nao pode apontar para tabela que')
  l.push('-- ainda nao existe, e criar em ordem de dependencia seria fragil.')
  l.push('')
  for (const r of daTabela('f')) {
    l.push(`ALTER TABLE ${ESQUEMA}.${r.tabela} ADD CONSTRAINT ${r.nome} ${r.definicao};`)
  }

  /*
   * PK e UK criam indice sozinhos -- o padrao diz, com todas as letras, que nao
   * e' necessario cria-los explicitamente. Repeti-los aqui produziria indice
   * duplicado, que ocupa espaco e desacelera escrita sem acelerar leitura.
   */
  const nomesDeRestricao = new Set(restricoes.map((r) => r.nome))
  const indicesProprios = indices.filter((i) => !nomesDeRestricao.has(i.nome))

  secao(`Os ${String(indicesProprios.length)} indices`)
  l.push('-- Um por chave estrangeira, como o padrao exige, mais os de desempenho.')
  l.push('')
  for (const i of indicesProprios) l.push(`${i.definicao};`)

  if (views.length > 0) {
    secao(`As ${String(views.length)} views`)
    for (const v of views) {
      l.push(`CREATE VIEW ${ESQUEMA}.${v.nome} AS`)
      l.push(v.definicao.trim().replace(/;$/, '') + ';')
      l.push('')
    }
  }

  secao(
    `Os ${String(tabelas.length + views.length + colunas.length + colsDeView.length)} comentarios`,
  )
  l.push('-- O padrao exige COMMENT na tabela e em TODAS as colunas (secao 7).')
  l.push('')
  for (const t of tabelas) {
    l.push(
      `COMMENT ON TABLE ${ESQUEMA}.${t.nome} IS ${lit(comentarioDaTabela(t.nome, t.comentario)!)};`,
    )
    for (const c of colunas.filter((x) => x.tabela === t.nome)) {
      l.push(
        `COMMENT ON COLUMN ${ESQUEMA}.${t.nome}.${c.coluna} IS ` +
          `${lit(comentarioDaColuna(t.nome, c.coluna, c.comentario)!)};`,
      )
    }
    l.push('')
  }
  for (const v of views) {
    /*
     * `COMMENT ON VIEW`, e nao `ON TABLE`: o Postgres recusa com 42809. A
     * especie vem do catalogo e nao do prefixo `vw_` -- nome e' convencao, e
     * uma view que fugisse dela quebraria o script inteiro, que roda em
     * transacao unica.
     */
    l.push(`COMMENT ON VIEW ${ESQUEMA}.${v.nome} IS ${lit(comentarioDaTabela(v.nome, v.comentario)!)};`)
    for (const c of colsDeView.filter((x) => x.tabela === v.nome)) {
      l.push(
        `COMMENT ON COLUMN ${ESQUEMA}.${v.nome}.${c.coluna} IS ` +
          `${lit(comentarioDaColuna(v.nome, c.coluna, c.comentario)!)};`,
      )
    }
    l.push('')
  }

  secao('O dono dos objetos')
  l.push('-- Exigido pelo padrao no Postgres (secao 7, ultimo item).')
  l.push('--')
  l.push('-- CURRENT_USER e nao um papel fixo: o usuario da aplicacao tem nome')
  l.push('-- diferente em cada ambiente (local `portalgd`, servidor')
  l.push('-- `portal_gerenciamento_diario_user`). Fixar derruba o script nos')
  l.push('-- outros -- ja aconteceu, com `role "portalgd" does not exist`.')
  l.push('')
  for (const t of tabelas) l.push(`ALTER TABLE ${ESQUEMA}.${t.nome} OWNER TO CURRENT_USER;`)
  for (const v of views) l.push(`ALTER VIEW ${ESQUEMA}.${v.nome} OWNER TO CURRENT_USER;`)
  for (const t of tipos) l.push(`ALTER TYPE ${ESQUEMA}.${t.nome} OWNER TO CURRENT_USER;`)

  mkdirSync(DESTINO, { recursive: true })
  const arquivo = path.join(DESTINO, `${SEQUENCIAL}-${NOME}.sql`)
  writeFileSync(arquivo, l.join('\n') + '\n', 'utf8')

  // ── O RECUPERA, na ordem inversa ──────────────────────────────────────────
  const r: string[] = [RECUPERA_CABECALHO(tabelas.length)]
  r.push('')
  for (const v of views) r.push(`DROP VIEW IF EXISTS ${ESQUEMA}.${v.nome};`)
  r.push('')
  r.push('-- CASCADE leva junto as chaves estrangeiras que apontam para a tabela.')
  r.push('-- Sem ele, a ordem de remocao teria de ser a inversa exata das')
  r.push('-- dependencias -- fragil, e refeita a cada tabela nova.')
  r.push('')
  for (const t of [...tabelas].reverse()) {
    r.push(`DROP TABLE IF EXISTS ${ESQUEMA}.${t.nome} CASCADE;`)
  }
  r.push('')
  r.push('-- Os tipos por ultimo: um tipo em uso nao pode ser removido.')
  r.push('')
  for (const t of [...tipos].reverse()) r.push(`DROP TYPE IF EXISTS ${ESQUEMA}.${t.nome};`)

  const arquivoR = path.join(DESTINO, `${SEQUENCIAL}-${NOME}-RECUPERA.sql`)
  writeFileSync(arquivoR, r.join('\n') + '\n', 'utf8')

  console.log(arquivo)
  console.log(`  ${String(tipos.length)} tipos, ${String(tabelas.length)} tabelas, ` +
    `${String(colunas.length)} colunas, ${String(views.length)} view(s)`)
  console.log(`  ${String(daTabela('p').length)} PK, ${String(daTabela('u').length)} UK, ` +
    `${String(daTabela('c').length)} CK, ${String(daTabela('f').length)} FK, ` +
    `${String(indicesProprios.length)} indices`)
  console.log(`  ${String(l.filter((x) => x.trim().startsWith('COMMENT')).length)} comentarios`)
  console.log(arquivoR)
}

const CABECALHO = (nTab: number, nCol: number, nTipos: number) => `-- Portal GD - criacao do banco de producao
--
-- GERADO por scripts/gerar-gmud-criacao.ts a partir do banco de
-- desenvolvimento, que ja passou pelos scripts 1 a 7 desta pasta e por isso e'
-- a unica fonte que conhece o estado REAL: os nomes adequados ao padrao, os
-- indices acrescentados a mao, os comentarios aplicados.
--
-- Gerar a partir do \`schema.prisma\` produziria os nomes que o Prisma inventa
-- (\`_pkey\` em vez de \`_PK\`), que e' exatamente o que o script 1 existiu para
-- corrigir.
--
-- O QUE ELE CRIA: ${nTipos} tipos enumerados, ${nTab} tabelas com ${nCol} colunas, as chaves,
-- os indices, os comentarios e o dono. O banco de producao nasce VAZIO -- sem
-- seed, sem usuario ficticio, sem ocorrencia de exemplo. O que entra depois,
-- por INSERT, sao as dimensoes do handoff: 11 filiais, 4 indicadores, 12
-- variaveis, 36 pontos de causa e 24 agrupamentos.
--
-- ORDEM: dominios, tabelas, PK, UK, CK, FK, indices, view, comentarios, dono.
-- As FK vem depois de TODAS as tabelas porque uma chave nao pode apontar para
-- tabela que ainda nao existe, e criar em ordem de dependencia seria fragil.
--
-- Banco: Postgres. Nao ha tablespace a especificar nem sinonimo publico a
-- criar -- as exigencias de USER_DADOS, USER_INDEX e CREATE PUBLIC SYNONYM da
-- secao 7 se aplicam ao Oracle Corp e Filiais.
--
-- NAO HA \`_prisma_migrations\` AQUI, e e' deliberado: e' a tabela de controle da
-- ferramenta, nao do modelo. Mas ela tem consequencia, e o time que for subir
-- precisa saber: com o banco criado por ESTE script, o Prisma encontra um
-- schema cheio e um controle vazio, e RECUSA migrar com \`P3005 - The database
-- schema is not empty\`.
--
-- Duas saidas, e a escolha e' do DBA com o time de desenvolvimento:
--   (a) rodar \`prisma migrate resolve --applied\` para cada migracao ja
--       existente, marcando-as como aplicadas sem executa-las; dai em diante o
--       Prisma funciona normalmente;
--   (b) producao nunca usa o Prisma para migrar: toda mudanca de schema vira
--       GMUD, como esta.
--
-- SEM IF NOT EXISTS, seguindo os scripts 1 a 7 desta pasta: reexecucao falha
-- alto, e falhar alto e' o comportamento desejado -- diz que o script ja rodou.
--
-- Recuperacao: ${SEQUENCIAL}-${NOME}-RECUPERA.sql
-- LEIA O RECUPERA ANTES DE EXECUTAR: ele APAGA as tabelas e o dado dentro
-- delas. Num banco recem-criado isso e' inofensivo; depois do primeiro uso,
-- nao e'.`

const RECUPERA_CABECALHO = (nTab: number) => `-- Portal GD - RECUPERA de ${SEQUENCIAL}-${NOME}.sql
--
-- Remove as ${nTab} tabelas, a view e os tipos criados pelo script de ida.
--
-- LEIA ANTES DE EXECUTAR: isto APAGA DADO. Num banco recem-criado, que e' o
-- caso previsto -- a recuperacao de uma GMUD que acabou de rodar --, nao ha
-- dado a perder. Depois do primeiro uso do portal, ha': contramedidas,
-- marcacoes de ponto de causa, historico de carga e a trilha de auditoria.
--
-- Nao existe caminho de volta depois disto. Se houver qualquer duvida sobre o
-- banco ja estar em uso, faca backup antes.
--
-- A ORDEM E' A INVERSA da ida: view, tabelas, tipos. Os tipos por ultimo
-- porque um tipo em uso nao pode ser removido.`

await principal()
await prisma.$disconnect()
