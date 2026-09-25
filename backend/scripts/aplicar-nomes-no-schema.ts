import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Declara no `schema.prisma` os nomes de constraint e índice do padrão.
 *
 * O SQL da GMUD renomeia os objetos no banco. Só isso não basta: o Prisma
 * compara o schema com o banco e, achando nomes que não conhece, gera na
 * migração seguinte um `RENAME` de volta para o padrão dele. A adequação
 * duraria até o próximo `prisma migrate dev`.
 *
 * Então os nomes precisam estar declarados nos dois lugares — e vêm do MESMO
 * `mapeamento.json` que gerou o SQL, para não haver duas listas divergindo.
 *
 * O que este script NÃO faz: renomear campos ou modelos do TypeScript. O padrão
 * governa o banco; `@@map`/`map:` existem exatamente para separar as duas
 * coisas. Nenhuma linha de código da aplicação muda.
 *
 * Uso: npx tsx scripts/aplicar-nomes-no-schema.ts [--aplicar]
 */

interface Mapeamento {
  tabelas: Record<string, string>
  tipos: Record<string, string>
  pk: { de: string; para: string }[]
  fk: { tabela: string; colunas: string; de: string; para: string }[]
  unico: { tabela: string; colunas: string; de: string; para: string }[]
  indice: { tabela: string; colunas: string; de: string; para: string }[]
  indiceFk: { tabela: string; colunas: string; para: string }[]
}

const RAIZ = path.resolve(import.meta.dirname, '..')
const SCHEMA = path.join(RAIZ, 'prisma', 'schema.prisma')
const MAPA: Mapeamento = JSON.parse(
  readFileSync(path.resolve(RAIZ, '..', 'docs', 'gmud', 'mapeamento.json'), 'utf8'),
) as Mapeamento

const aplicar = process.argv.includes('--aplicar')
const original = readFileSync(SCHEMA, 'utf8')
const linhas = original.split('\n')

/** Nomes ficam minúsculos: o Postgres dobra identificador sem aspas. Ver §6. */
const norm = (s: string) => s.toLowerCase()

const alteracoes: string[] = []
const problemas: string[] = []

let modelo: string | null = null
let tabelaAtual = ''
let campos = new Map<string, string>()

/** Coleta o mapa campo→coluna de um bloco antes de reescrevê-lo. */
function lerBloco(inicio: number): { fim: number; tabela: string; campos: Map<string, string> } {
  const m = new Map<string, string>()
  let tabela = ''
  let i = inicio + 1
  for (; i < linhas.length; i++) {
    const l = linhas[i] ?? ''
    if (l.startsWith('}')) break
    const mapaTabela = /@@map\("([^"]+)"\)/.exec(l)
    if (mapaTabela?.[1] !== undefined && l.trim().startsWith('@@map')) tabela = mapaTabela[1]
    const campo = /^\s{2}(\w+)\s+\S/.exec(l)
    if (campo?.[1] !== undefined && !l.trim().startsWith('@@')) {
      const col = /@map\("([^"]+)"\)/.exec(l)
      m.set(campo[1], col?.[1] ?? campo[1])
    }
  }
  return { fim: i, tabela, campos: m }
}

const colunasDe = (lista: string, mapa: Map<string, string>) =>
  lista
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => mapa.get(c) ?? c)
    .join(', ')

function acharIndice(tipo: 'unico' | 'indice', tabela: string, colunas: string): string | null {
  const achado = MAPA[tipo].find((x) => x.tabela === tabela && x.colunas === colunas)
  return achado ? achado.para : null
}

for (let i = 0; i < linhas.length; i++) {
  const linha = linhas[i] ?? ''

  const abreModelo = /^model\s+(\w+)\s*\{/.exec(linha)
  if (abreModelo?.[1] !== undefined) {
    modelo = abreModelo[1]
    const bloco = lerBloco(i)
    tabelaAtual = MAPA.tabelas[bloco.tabela] ?? bloco.tabela
    campos = bloco.campos
    continue
  }

  const abreEnum = /^enum\s+(\w+)\s*\{/.exec(linha)
  if (abreEnum?.[1] !== undefined) {
    modelo = null
    // O nome físico do enum é o nome do modelo; o Prisma não converte.
    const fisico = abreEnum[1]
    const novo = MAPA.tipos[fisico]
    if (novo !== undefined) {
      let j = i + 1
      while (j < linhas.length && !(linhas[j] ?? '').startsWith('}')) j++
      if (!(linhas[j - 1] ?? '').includes('@@map')) {
        linhas.splice(j, 0, '', `  @@map("${norm(novo)}")`)
        alteracoes.push(`enum ${fisico} -> @@map("${norm(novo)}")`)
      }
    }
    continue
  }

  if (linha.startsWith('}')) {
    modelo = null
    continue
  }
  if (modelo === null) continue

  // ── @@map da tabela ────────────────────────────────────────────────────────
  const mapaTabela = /^\s+@@map\("([^"]+)"\)/.exec(linha)
  if (mapaTabela?.[1] !== undefined) {
    const novo = MAPA.tabelas[mapaTabela[1]]
    if (novo !== undefined) {
      linhas[i] = linha.replace(`"${mapaTabela[1]}"`, `"${novo}"`)
      alteracoes.push(`tabela ${mapaTabela[1]} -> ${novo}`)
    }

    /**
     * Os índices das chaves estrangeiras entram AQUI, logo antes do `@@map`.
     *
     * Só criá-los no SQL não basta: o Prisma removeria os 45 na migração
     * seguinte, por não os encontrar declarados. Ficam antes do `@@map` porque
     * é onde o `prisma format` os deixaria, e assim o arquivo já sai formatado.
     */
    const reverso = new Map([...campos].map(([campo, col]) => [col, campo]))
    const novos = MAPA.indiceFk
      .filter((x) => x.tabela === tabelaAtual)
      .map((x) => {
        const cols = x.colunas
          .split(',')
          .map((c) => c.trim())
          .map((c) => reverso.get(c) ?? c)
          .join(', ')
        return `  @@index([${cols}], map: "${norm(x.para)}")`
      })
      .filter((l) => !linhas.slice(0, i).some((existente) => existente === l))
    if (novos.length > 0) {
      linhas.splice(i, 0, ...novos)
      i += novos.length
      alteracoes.push(...novos.map(() => `IDXFK ${tabelaAtual}`))
    }
    continue
  }

  // ── chave primária composta ────────────────────────────────────────────────
  const idComposto = /^(\s+@@id\(\[[^\]]+\])(.*)$/.exec(linha)
  if (idComposto?.[1] !== undefined) {
    const nome = norm(`${tabelaAtual}_PK`)
    linhas[i] = `${idComposto[1]}, map: "${nome}")`
    alteracoes.push(`PK ${tabelaAtual} -> ${nome}`)
    continue
  }

  // ── chave primária simples ─────────────────────────────────────────────────
  if (/\s@id(\s|$)/.test(linha)) {
    const nome = norm(`${tabelaAtual}_PK`)
    linhas[i] = linha.replace(/(\s)@id(\s|$)/, `$1@id(map: "${nome}")$2`)
    alteracoes.push(`PK ${tabelaAtual} -> ${nome}`)
  }

  // ── unique de coluna única ─────────────────────────────────────────────────
  const linhaAtual = linhas[i] ?? ''
  if (/\s@unique(\s|$)/.test(linhaAtual)) {
    const campo = /^\s{2}(\w+)\s+\S/.exec(linhaAtual)
    const col = campo?.[1] !== undefined ? (campos.get(campo[1]) ?? campo[1]) : ''
    const nome = acharIndice('unico', tabelaAtual, col)
    if (nome !== null) {
      linhas[i] = linhaAtual.replace(/(\s)@unique(\s|$)/, `$1@unique(map: "${norm(nome)}")$2`)
      alteracoes.push(`UK ${tabelaAtual}(${col}) -> ${norm(nome)}`)
    } else problemas.push(`unique sem par no mapeamento: ${tabelaAtual}(${col})`)
  }

  // ── relação (chave estrangeira) ────────────────────────────────────────────
  const rel = /@relation\((.*)\)\s*$/.exec(linhas[i] ?? '')
  const camposRel = rel?.[1] !== undefined ? /fields:\s*\[([^\]]+)\]/.exec(rel[1]) : null
  if (rel?.[1] !== undefined && camposRel?.[1] !== undefined && !rel[1].includes('map:')) {
    const cols = colunasDe(camposRel[1], campos)
    const achado = MAPA.fk.find((f) => f.tabela === tabelaAtual && f.colunas === cols)
    if (achado) {
      linhas[i] = (linhas[i] ?? '').replace(/@relation\((.*)\)\s*$/, (_m, dentro: string) => {
        return `@relation(${dentro}, map: "${norm(achado.para)}")`
      })
      alteracoes.push(`FK ${tabelaAtual}(${cols}) -> ${norm(achado.para)}`)
    } else problemas.push(`FK sem par no mapeamento: ${tabelaAtual}(${cols})`)
  }

  // ── @@index e @@unique compostos ───────────────────────────────────────────
  for (const [attr, tipo] of [
    ['@@index', 'indice'],
    ['@@unique', 'unico'],
  ] as const) {
    const m = new RegExp(`^(\\s+${attr}\\(\\[([^\\]]+)\\])(.*)$`).exec(linhas[i] ?? '')
    if (m?.[1] === undefined || m[2] === undefined) continue
    const cols = colunasDe(m[2], campos)
    const nome = acharIndice(tipo, tabelaAtual, cols)
    if (nome === null) {
      problemas.push(`${attr} sem par no mapeamento: ${tabelaAtual}(${cols})`)
      continue
    }
    linhas[i] = `${m[1]}, map: "${norm(nome)}")`
    alteracoes.push(`${attr === '@@index' ? 'IDX' : 'UK'} ${tabelaAtual}(${cols}) -> ${norm(nome)}`)
  }
}

const resultado = linhas.join('\n')
console.log(`  ${alteracoes.length} alteracao(oes) no schema.prisma`)
for (const t of ['tabela', 'enum', 'PK', 'FK', 'UK', 'IDX']) {
  const n = alteracoes.filter((a) => a.startsWith(t)).length
  if (n > 0) console.log(`    ${t.padEnd(7)} ${n}`)
}
if (problemas.length > 0) {
  console.log(`\n  ${problemas.length} SEM PAR — precisam de atencao:`)
  for (const p of problemas) console.log(`    ${p}`)
}
if (!aplicar) {
  console.log('\n  SECO — nada gravado. Repita com --aplicar.')
} else {
  writeFileSync(SCHEMA, resultado, 'utf8')
  console.log('\n  schema.prisma gravado.')
}
