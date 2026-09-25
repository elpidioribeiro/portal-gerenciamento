import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

/**
 * Gera os scripts de GMUD que põem o banco do portal no padrão de nomenclatura
 * da empresa (documento "Padrões de Nomenclatura e Criação de Scripts", AcmeLabs).
 *
 * Gerador, e não SQL escrito à mão, por um motivo simples: são 9 tabelas, 26
 * chaves primárias, 45 estrangeiras, 22 índices, as constraints unique e de
 * check, 10 tipos e um índice novo por chave estrangeira. Escrever isso à mão é
 * como se erra — e o erro aqui não aparece em teste, aparece na GMUD sendo
 * devolvida, ou pior, num `RENAME` que não casa com o `schema.prisma` e deixa a
 * aplicação procurando tabela que não existe mais.
 *
 * A fonte é o BANCO VIVO, não o schema. O que precisa ser renomeado é o que
 * está lá, com os nomes que o Prisma realmente gerou.
 *
 * Emite, para cada mudança, o script e o seu par `-RECUPERA`, como o padrão
 * exige. O de recuperação é gerado invertendo a mesma lista, então não há como
 * um sair de sincronia com o outro.
 *
 * Uso: npx tsx --env-file=.env scripts/gerar-gmud-nomenclatura.ts
 */

const DESTINO = path.resolve(import.meta.dirname, '..', '..', 'docs', 'gmud')
const ESQUEMA = 'public'

/**
 * `CURRENT_USER`, não um nome fixo de papel.
 *
 * O padrão pede o `ALTER TABLE ... OWNER TO` no Postgres, e o exemplo dele usa
 * nome literal. Nome literal quebra: em desenvolvimento local o papel é
 * `portalgd`, no servidor é `portal_gerenciamento_diario_user`, e em produção
 * será outro. Fixar um deles derruba a migração nos demais — foi o que
 * aconteceu, com `role "portalgd" does not exist` no RDS.
 *
 * `CURRENT_USER` resolve para quem está aplicando a migração, que é justamente
 * o papel da aplicação naquele ambiente. Em cada banco as tabelas já nascem
 * dele, então o comando é inócuo — e é a intenção da regra: garantir que o dono
 * seja o papel da aplicação, não de quem por acaso rodou o script.
 */
const OWNER = 'CURRENT_USER'

/**
 * Tabelas fora do padrão e o nome novo.
 *
 * - plural: `fato_perdas`, `fato_vendas`, `fato_vendas_linha`
 * - inglês: `audit_log`, `refresh_token`, `bucket`
 * - idiomas misturados: `sync_execucao`
 * - abreviatura: `dim_` de "dimensão", que o padrão manda evitar
 *
 * `bucket` vira `agrupamento` porque é o que ele faz — agrupa pessoas, pontos
 * de causa e contramedidas por nível ("Vendas", "Suprimentos", "Pisos e
 * Revestimentos"). "Bucket" era o termo do handoff, não do negócio.
 *
 * `fato_nps` FICA. O padrão manda evitar acrônimos, mas NPS é o nome do
 * indicador para a diretoria, está no handoff e nas telas; traduzir criaria uma
 * palavra que ninguém usa para achar a tabela. Divergência consciente, para
 * registrar na GMUD em vez de esconder.
 */
const RENOMEIA_TABELA: Record<string, string> = {
  fato_perdas: 'fato_perda',
  fato_vendas: 'fato_venda',
  fato_vendas_linha: 'fato_venda_linha',
  audit_log: 'log_auditoria',
  refresh_token: 'renovacao_sessao',
  sync_execucao: 'execucao_sincronizacao',
  bucket: 'agrupamento',
  dim_area_venda: 'dimensao_area_venda',
  dim_linha: 'dimensao_linha',
}

/**
 * Lê o banco de TESTE, não o de desenvolvimento.
 *
 * O gerador só precisa da ESTRUTURA, e o banco de teste tem a mesma — vinda das
 * mesmas migrações. Ler o de desenvolvimento seria abrir conexão com o servidor
 * para descobrir nomes de constraint que estão igualmente na cópia local.
 */
const urlTeste = process.env.DATABASE_URL_TEST
if (urlTeste === undefined || urlTeste.trim() === '') {
  throw new Error('DATABASE_URL_TEST não definida. O gerador lê a estrutura do banco de teste.')
}
const prisma = new PrismaClient({ datasources: { db: { url: urlTeste } } })
const nova = (t: string) => RENOMEIA_TABELA[t] ?? t
const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)

/**
 * `EscopoMeta` -> `escopo_meta`.
 *
 * Os enums são os únicos objetos que o Prisma cria com o nome do modelo entre
 * aspas, preservando maiúsculas: no catálogo eles estão como `"EscopoMeta"`,
 * não `escopometa`. Duas consequências, ambas custaram uma execução falha:
 *
 * 1. para REFERENCIAR o nome antigo é obrigatório usar aspas — sem elas o
 *    Postgres dobra para minúsculo e o `ALTER TYPE` não acha o tipo. O §6 do
 *    padrão proíbe CRIAR com aspas, não impede citar o que já existe torto;
 * 2. baixar tudo para minúsculo geraria `escopometa_type`, colando as palavras.
 *    O padrão manda separar por `_`, então a conversão tem de ser de
 *    PascalCase para snake_case, não um `toLowerCase()`.
 */
const paraSnake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()

interface Par {
  de: string
  para: string
  comentario: string
}

async function main() {
  mkdirSync(DESTINO, { recursive: true })

  /**
   * Recusa rodar contra um banco já adequado.
   *
   * O gerador lê o banco vivo para saber o que renomear. Rodando de novo depois
   * da migração aplicada, ele lê o estado FINAL e produz um mapeamento vazio de
   * renomeações — que, alimentando o `schema.prisma`, desfaz tudo em silêncio.
   * Aconteceu: 27 objetos ficaram "sem par" e o schema saiu inconsistente.
   *
   * O sinal é a chave primária: `_pkey` é o Prisma, `_pk` é o padrão.
   */
  const [{ n: aindaPrisma } = { n: 0n }] = await q<{ n: bigint }>(
    `SELECT count(*) AS n FROM pg_constraint WHERE contype = 'p' AND conname LIKE '%\\_pkey'
     AND conname <> '_prisma_migrations_pkey'`,
  )
  if (Number(aindaPrisma) === 0) {
    throw new Error(
      'Este banco já está no padrão (nenhuma chave primária com sufixo _pkey).\n' +
        'Rodar de novo geraria um mapeamento vazio e desfaria a adequação no schema.prisma.\n' +
        'Para regerar, use um banco no estado anterior à migração de nomenclatura.',
    )
  }

  const tabelas = (
    await q<{ nome: string }>(
      `SELECT c.relname AS nome FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = '${ESQUEMA}' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
       ORDER BY c.relname`,
    )
  ).map((t) => t.nome)

  const constraints = await q<{
    tabela: string
    nome: string
    tipo: string
    destino: string | null
    colunas: string
  }>(`
    SELECT o.relname AS tabela, c.conname AS nome, c.contype::text AS tipo,
           d.relname AS destino,
           (SELECT string_agg(a.attname, ', ' ORDER BY x.ord)
            FROM unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum) AS colunas
    FROM pg_constraint c
    JOIN pg_class o ON o.oid = c.conrelid
    LEFT JOIN pg_class d ON d.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = o.relnamespace
    WHERE n.nspname = '${ESQUEMA}' AND o.relname <> '_prisma_migrations'
    ORDER BY o.relname, c.contype, c.conname`)

  /**
   * Índices, separados por unicidade.
   *
   * O Prisma cria `@@unique` como ÍNDICE ÚNICO, não como constraint UNIQUE — por
   * isso a consulta de constraints devolve zero `u`. Se eles entrassem no balde
   * comum, receberiam `_IDXNN` e o nome deixaria de dizer que ali existe uma
   * regra de unicidade. O padrão tem sufixo próprio (`_UKNN`), e é o que a
   * intenção pede, mesmo o objeto sendo índice e não constraint.
   */
  const todosIndices = await q<{
    tabela: string
    nome: string
    unico: boolean
    colunas: string
  }>(`
    SELECT t.relname AS tabela, i.relname AS nome, x.indisunique AS unico,
           (SELECT string_agg(a.attname, ', ' ORDER BY k.ord)
            FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum) AS colunas
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = '${ESQUEMA}' AND t.relname <> '_prisma_migrations'
      AND i.relname NOT IN (SELECT conname FROM pg_constraint)
    ORDER BY t.relname, i.relname`)
  const indices = todosIndices.filter((i) => !i.unico)
  const unicos = todosIndices.filter((i) => i.unico)

  const tipos = (
    await q<{ nome: string }>(
      `SELECT t.typname AS nome FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = '${ESQUEMA}' AND t.typtype = 'e' ORDER BY t.typname`,
    )
  ).map((t) => t.nome)

  // ── Nomes novos ──────────────────────────────────────────────────────────
  const pks: Par[] = constraints
    .filter((c) => c.tipo === 'p')
    .map((c) => ({
      de: c.nome,
      para: `${nova(c.tabela)}_PK`,
      comentario: `chave primaria de ${nova(c.tabela)}`,
    }))

  const usoFk = new Map<string, number>()
  for (const c of constraints.filter((x) => x.tipo === 'f')) {
    const base = `${nova(c.tabela)}_${nova(c.destino ?? '')}`
    usoFk.set(base, (usoFk.get(base) ?? 0) + 1)
  }
  const colide = new Set([...usoFk].filter(([, n]) => n > 1).map(([b]) => b))
  const ordemFk = new Map<string, number>()
  const fks: Par[] = constraints
    .filter((c) => c.tipo === 'f')
    .map((c) => {
      const base = `${nova(c.tabela)}_${nova(c.destino ?? '')}`
      const n = (ordemFk.get(base) ?? 0) + 1
      ordemFk.set(base, n)
      return {
        de: c.nome,
        para: colide.has(base) ? `${base}${String(n).padStart(2, '0')}_FK` : `${base}_FK`,
        comentario: `${nova(c.tabela)} (${c.colunas}) -> ${nova(c.destino ?? '')}`,
      }
    })

  const sequencial = (lista: { tabela: string }[], sufixo: string) => {
    const conta = new Map<string, number>()
    return lista.map((x) => {
      const n = (conta.get(x.tabela) ?? 0) + 1
      conta.set(x.tabela, n)
      return `${nova(x.tabela)}_${sufixo}${String(n).padStart(2, '0')}`
    })
  }

  const uksNovos = sequencial(unicos, 'UK')
  const uks: Par[] = unicos.map((u, i) => ({
    de: u.nome,
    para: uksNovos[i] ?? '',
    comentario: `unicidade em ${nova(u.tabela)}`,
  }))

  const cksOrig = constraints.filter((c) => c.tipo === 'c')
  const cksNovos = sequencial(cksOrig, 'CK')
  const cks: Par[] = cksOrig.map((c, i) => ({
    de: c.nome,
    para: cksNovos[i] ?? '',
    comentario: `check em ${nova(c.tabela)}`,
  }))

  const idxNovos = sequencial(indices, 'IDX')
  const idx: Par[] = indices.map((x, i) => ({
    de: x.nome,
    para: idxNovos[i] ?? '',
    comentario: `indice de ${nova(x.tabela)}`,
  }))

  const contaIdx = new Map<string, number>()
  for (const x of indices) contaIdx.set(nova(x.tabela), (contaIdx.get(nova(x.tabela)) ?? 0) + 1)

  /**
   * Um índice por chave estrangeira, como o padrão exige.
   *
   * A numeração CONTINUA de onde os índices existentes pararam, em vez de
   * recomeçar: `_IDXNN` é "ordem de criação do índice na tabela", e reiniciar
   * geraria nome repetido na mesma tabela.
   */
  const idxFk = constraints
    .filter((c) => c.tipo === 'f')
    .map((c) => {
      const t = nova(c.tabela)
      const n = (contaIdx.get(t) ?? 0) + 1
      contaIdx.set(t, n)
      return { tabela: t, nome: `${t}_IDX${String(n).padStart(2, '0')}`, colunas: c.colunas }
    })

  const cab = (titulo: string, descricao: string) =>
    `-- ${titulo}\n--\n${descricao
      .trim()
      .split('\n')
      .map((l) => `-- ${l}`.trimEnd())
      .join('\n')}\n\n`

  // ── Script 1: renomeações ────────────────────────────────────────────────
  const renTabelas = Object.entries(RENOMEIA_TABELA).filter(([de]) => tabelas.includes(de))

  let s1 = cab(
    'Portal GD - adequacao ao padrao de nomenclatura',
    `Renomeia tabelas, constraints, indices e tipos do esquema ${ESQUEMA} para o
padrao do documento "Padroes de Nomenclatura e Criacao de Scripts".

Nenhum dado e' movido, copiado ou apagado: RENAME altera apenas o nome do
objeto no catalogo. As linhas ja conferidas contra o Power BI
permanecem onde estao.

A view vw_tipo_perda NAO precisa ser recriada: o Postgres guarda a
dependencia por identificador interno, nao por nome, e ela passa a apontar
para fato_perda sozinha.

Recuperacao: 1-renomeia_objetos_portal_gd-RECUPERA.sql`,
  )

  s1 += '-- Tabelas\n'
  for (const [de, para] of renTabelas)
    s1 += `ALTER TABLE ${ESQUEMA}.${de} RENAME TO ${para};\n`

  for (const [rotulo, lista] of [
    ['Chaves primarias', pks],
    ['Chaves estrangeiras', fks],
    ['Constraints de check', cks],
  ] as const) {
    s1 += `\n-- ${rotulo}\n`
    for (const p of lista) {
      const tab = constraints.find((c) => c.nome === p.de)?.tabela ?? ''
      s1 += `ALTER TABLE ${ESQUEMA}.${nova(tab)} RENAME CONSTRAINT ${p.de} TO ${p.para};\n`
    }
  }

  s1 += '\n-- Unicidade (o Prisma cria @@unique como indice unico)\n'
  for (const p of uks) s1 += `ALTER INDEX ${ESQUEMA}.${p.de} RENAME TO ${p.para};\n`

  s1 += '\n-- Indices\n'
  for (const p of idx) s1 += `ALTER INDEX ${ESQUEMA}.${p.de} RENAME TO ${p.para};\n`

  s1 += `\n-- Tipos (enums)\n`
  for (const t of tipos)
    s1 += `ALTER TYPE ${ESQUEMA}."${t}" RENAME TO ${paraSnake(t)}_type;\n`

  s1 += `\n-- Owner das tabelas (regra especifica de Postgres)\n`
  for (const t of tabelas) s1 += `ALTER TABLE ${ESQUEMA}.${nova(t)} OWNER TO ${OWNER};\n`

  // ── Script 1 RECUPERA ────────────────────────────────────────────────────
  let r1 = cab(
    'Portal GD - RECUPERA adequacao ao padrao de nomenclatura',
    `Desfaz 1-renomeia_objetos_portal_gd.sql, devolvendo todos os nomes
anteriores. Gerado invertendo a MESMA lista do script de ida, para que os dois
nao possam divergir.

Ordem inversa: tipos e indices primeiro, tabelas por ultimo.`,
  )
  r1 += '-- Tipos (enums)\n'
  for (const t of tipos)
    r1 += `ALTER TYPE ${ESQUEMA}.${paraSnake(t)}_type RENAME TO "${t}";\n`
  r1 += '\n-- Indices\n'
  for (const p of idx) r1 += `ALTER INDEX ${ESQUEMA}.${p.para} RENAME TO ${p.de};\n`
  r1 += '\n-- Unicidade\n'
  for (const p of uks) r1 += `ALTER INDEX ${ESQUEMA}.${p.para} RENAME TO ${p.de};\n`
  for (const [rotulo, lista] of [
    ['Constraints de check', cks],
    ['Chaves estrangeiras', fks],
    ['Chaves primarias', pks],
  ] as const) {
    r1 += `\n-- ${rotulo}\n`
    for (const p of lista) {
      const tab = constraints.find((c) => c.nome === p.de)?.tabela ?? ''
      r1 += `ALTER TABLE ${ESQUEMA}.${nova(tab)} RENAME CONSTRAINT ${p.para} TO ${p.de};\n`
    }
  }
  r1 += '\n-- Tabelas\n'
  for (const [de, para] of renTabelas)
    r1 += `ALTER TABLE ${ESQUEMA}.${para} RENAME TO ${de};\n`

  // ── Script 2: indices das chaves estrangeiras ────────────────────────────
  let s2 = cab(
    'Portal GD - indices das chaves estrangeiras',
    `Cria um indice por chave estrangeira, com as mesmas colunas da chave, como
pede o padrao.

Sao ${idxFk.length} indices. A numeracao _IDXNN continua de onde os indices
existentes pararam, porque NN e' a ordem de criacao na tabela e recomecar
geraria nome repetido.

Executar DEPOIS de 1-renomeia_objetos_portal_gd.sql: os nomes abaixo ja usam
os nomes novos das tabelas.

Recuperacao: 2-cria_indice_chave_estrangeira-RECUPERA.sql`,
  )
  for (const i of idxFk)
    s2 += `CREATE INDEX ${i.nome} ON ${ESQUEMA}.${i.tabela} (${i.colunas});\n`

  let r2 = cab(
    'Portal GD - RECUPERA indices das chaves estrangeiras',
    'Remove os indices criados por 2-cria_indice_chave_estrangeira.sql.',
  )
  for (const i of idxFk) r2 += `DROP INDEX ${ESQUEMA}.${i.nome};\n`

  /**
   * Mapeamento em JSON, para o `schema.prisma` ser ajustado a partir da MESMA
   * fonte que gerou o SQL.
   *
   * Sem isto haveria duas listas de nomes novos — uma no script, outra no
   * schema — e bastaria uma divergir para o Prisma passar a acusar deriva e
   * tentar desfazer a renomeação na migração seguinte.
   */
  const mapa = {
    tabelas: Object.fromEntries(renTabelas),
    tipos: Object.fromEntries(tipos.map((t) => [t, `${paraSnake(t)}_type`])),
    /**
     * Os índices novos das chaves estrangeiras também vão para o schema.
     *
     * Criá-los só no SQL deixaria o Prisma vendo 45 índices que ele não
     * declara, e a próxima migração os removeria — desfazendo a adequação sem
     * ninguém pedir. Medido: `migrate diff` acusou os 45.
     */
    indiceFk: idxFk.map((i) => ({ tabela: i.tabela, colunas: i.colunas, para: i.nome })),
    pk: pks.map((p) => ({ de: p.de, para: p.para })),
    fk: constraints
      .filter((c) => c.tipo === 'f')
      .map((c, i) => ({
        tabela: nova(c.tabela),
        colunas: c.colunas,
        de: c.nome,
        para: fks[i]?.para ?? '',
      })),
    unico: unicos.map((u, i) => ({
      tabela: nova(u.tabela),
      colunas: u.colunas,
      de: u.nome,
      para: uks[i]?.para ?? '',
    })),
    indice: indices.map((x, i) => ({
      tabela: nova(x.tabela),
      colunas: x.colunas,
      de: x.nome,
      para: idx[i]?.para ?? '',
    })),
  }
  writeFileSync(path.join(DESTINO, 'mapeamento.json'), `${JSON.stringify(mapa, null, 2)}\n`, 'utf8')

  const arquivos: [string, string][] = [
    ['1-renomeia_objetos_portal_gd.sql', s1],
    ['1-renomeia_objetos_portal_gd-RECUPERA.sql', r1],
    ['2-cria_indice_chave_estrangeira.sql', s2],
    ['2-cria_indice_chave_estrangeira-RECUPERA.sql', r2],
  ]
  for (const [nome, conteudo] of arquivos) {
    writeFileSync(path.join(DESTINO, nome), conteudo, 'utf8')
    const linhas = conteudo.split('\n').filter((l) => l.trim() && !l.startsWith('--')).length
    console.log(`  ${nome.padEnd(45)} ${String(linhas).padStart(3)} comandos`)
  }

  console.log(
    `\n  tabelas ${tabelas.length} (renomeadas ${renTabelas.length}) · PK ${pks.length} · ` +
      `FK ${fks.length} · UK ${uks.length} · CK ${cks.length} · indices ${idx.length} ` +
      `(+${idxFk.length} novos) · tipos ${tipos.length}`,
  )
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
