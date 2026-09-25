import { PrismaClient } from '@prisma/client'

/**
 * Copia o conteúdo de um banco do portal para outro, tabela a tabela.
 *
 * Existe porque a máquina não tem `pg_dump` nem `psql`: o `embedded-postgres`
 * traz só `initdb`, `pg_ctl` e `postgres`, e instalar o cliente do Postgres
 * exigiria privilégio de administrador. Trinta e seis mil linhas passam por
 * `createMany` sem dificuldade — o gargalo é a latência, não o volume.
 *
 * Serve ao caso concreto de sair do Postgres local para o do servidor. O que faz
 * a cópia preferível a recarregar da origem:
 *
 * - as **dimensões** (filiais, indicadores, variáveis, pontos de causa, metas,
 *   usuários) não têm origem externa nenhuma — nascem do seed, e o seed também
 *   gera fato sintético, que é justamente o que não se quer no banco novo;
 * - os **fatos** já foram conferidos contra o Power BI valor a valor; recarregar
 *   significaria repetir cinco fluxos do n8n janela por janela e reconferir.
 *
 * Uso:
 *   npx tsx scripts/copiar-banco.ts <URL_ORIGEM> <URL_DESTINO> [--forcar]
 *
 * Preferir variável de ambiente a argumento quando a URL tiver senha: argumento
 * de linha de comando aparece na lista de processos.
 *   COPIA_ORIGEM=... COPIA_DESTINO=... npx tsx scripts/copiar-banco.ts
 */

/**
 * Ordem de inserção: pai antes de filho.
 *
 * É a ordem inversa do `limpar()` do seed, e a razão é a mesma — a de lá apaga
 * filho antes de pai. Errar aqui não corrompe nada, o Postgres recusa por chave
 * estrangeira; mas o erro sai no meio da cópia, com metade do banco escrita.
 */
const TABELAS = [
  'perfilNivel',
  'filial',
  'bucket',
  'usuario',
  'dimAreaVenda',
  'dimLinha',
  'indicador',
  'variavelControle',
  'pontoCausa',
  'perfilVariavel',
  'meta',
  'syncExecucao',
  'fatoVendas',
  'fatoVendasLinha',
  'fatoNps',
  'fatoPerdas',
  'fatoMovimentacao',
  'fatoCusto',
  'fatoVariavelControle',
  'ocorrenciaPontoCausa',
  'contramedida',
  'movimentacao',
  'comentario',
  'auditLog',
] as const

/**
 * `refresh_token` fica fora de propósito.
 *
 * São sessões abertas, atadas ao ambiente em que foram emitidas. Copiar daria
 * ao banco novo tokens válidos que ninguém pediu — e quem estava logado tem de
 * logar de novo mesmo, porque o portal passou a apontar para outro banco.
 */
const IGNORADAS = ['refreshToken'] as const

/** Lotes por `createMany`. Pequeno por causa da latência remota, não do volume. */
const LOTE = 1000

function url(posicional: string | undefined, variavel: string): string {
  const v = posicional ?? process.env[variavel]
  if (!v) {
    throw new Error(
      `Falta a URL de ${variavel === 'COPIA_ORIGEM' ? 'origem' : 'destino'}.\n` +
        'Uso: npx tsx scripts/copiar-banco.ts <URL_ORIGEM> <URL_DESTINO>\n' +
        `ou defina ${variavel} no ambiente (preferível quando a URL tem senha: ` +
        'argumento de linha de comando aparece na lista de processos).',
    )
  }
  return v
}

/** Host e banco, sem credencial — isto vai para a tela e para log. */
function rotulo(u: string): string {
  const x = new URL(u)
  return `${x.hostname}/${x.pathname.replace(/^\//, '')}`
}

async function main() {
  const argumentos = process.argv.slice(2)
  const forcar = argumentos.includes('--forcar')
  const posicionais = argumentos.filter((a) => !a.startsWith('--'))

  const origem = url(posicionais[0], 'COPIA_ORIGEM')
  const destino = url(posicionais[1], 'COPIA_DESTINO')

  if (new URL(origem).href === new URL(destino).href) {
    throw new Error('Origem e destino são o mesmo banco.')
  }

  console.log(`Origem : ${rotulo(origem)}`)
  console.log(`Destino: ${rotulo(destino)}\n`)

  const de = new PrismaClient({ datasources: { db: { url: origem } } })
  const para = new PrismaClient({ datasources: { db: { url: destino } } })

  try {
    /**
     * Destino vazio é a condição normal. Com dado dentro, a cópia colidiria em
     * chave primária no meio do caminho e deixaria o banco pela metade —
     * pior que não começar. O `--forcar` existe para retomar uma cópia
     * interrompida, e nesse caso o `skipDuplicates` cuida do que já passou.
     */
    const ocupadas: string[] = []
    for (const t of TABELAS) {
      const n = await contar(para, t)
      if (n > 0) ocupadas.push(`${t}=${n}`)
    }
    if (ocupadas.length > 0 && !forcar) {
      throw new Error(
        `O destino não está vazio: ${ocupadas.join(' · ')}.\n` +
          'Se a intenção é retomar uma cópia interrompida, repita com --forcar ' +
          '(as linhas já existentes são ignoradas por chave primária).',
      )
    }

    const resumo: Array<{ tabela: Nome; lidas: number; escritas: number }> = []

    for (const tabela of TABELAS) {
      const linhas = await ler(de, tabela)
      if (linhas.length === 0) {
        resumo.push({ tabela, lidas: 0, escritas: 0 })
        continue
      }

      let escritas = 0
      for (let i = 0; i < linhas.length; i += LOTE) {
        const lote = linhas.slice(i, i + LOTE)
        const r = await escrever(para, tabela, lote)
        escritas += r
      }

      resumo.push({ tabela, lidas: linhas.length, escritas })
      console.log(`  ${tabela.padEnd(22)} ${String(escritas).padStart(6)} de ${linhas.length}`)
    }

    /**
     * Conferência no destino, não confiança no retorno do `createMany`.
     *
     * O `skipDuplicates` faz o número de escritas divergir legitimamente do de
     * leituras, e um erro de ordem ou de tipo poderia gravar menos sem falhar.
     * A checagem que importa é a contagem final de cada tabela.
     */
    console.log('\nConferindo o destino...')
    const divergentes: string[] = []
    for (const { tabela, lidas } of resumo) {
      const n = await contar(para, tabela)
      if (n !== lidas) divergentes.push(`${tabela}: origem ${lidas}, destino ${n}`)
    }

    const total = resumo.reduce((a, r) => a + r.lidas, 0)

    if (divergentes.length > 0) {
      throw new Error(`A cópia NÃO fecha:\n  ${divergentes.join('\n  ')}`)
    }

    console.log(`  ${total} linhas em ${resumo.filter((r) => r.lidas > 0).length} tabelas — fecha.`)
    console.log(`\nIgnorado de propósito: ${IGNORADAS.join(', ')} (sessões abertas).`)
  } finally {
    await de.$disconnect()
    await para.$disconnect()
  }
}

/**
 * Os três acessos dinâmicos ao cliente ficam isolados aqui.
 *
 * O Prisma não tipa indexação por nome de modelo, e espalhar a asserção pelo
 * arquivo esconderia onde a segurança de tipo termina. `TABELAS` é constante
 * deste arquivo e o `as const` garante que um nome errado não compile.
 */
type Cliente = PrismaClient
type Nome = (typeof TABELAS)[number]

function delegate(c: Cliente, t: Nome): {
  count: () => Promise<number>
  findMany: () => Promise<unknown[]>
  createMany: (a: { data: unknown[]; skipDuplicates: boolean }) => Promise<{ count: number }>
} {
  return (c as unknown as Record<Nome, ReturnType<typeof delegate>>)[t]
}

async function contar(c: Cliente, t: Nome): Promise<number> {
  return delegate(c, t).count()
}

async function ler(c: Cliente, t: Nome): Promise<unknown[]> {
  return delegate(c, t).findMany()
}

async function escrever(c: Cliente, t: Nome, dados: unknown[]): Promise<number> {
  const r = await delegate(c, t).createMany({ data: dados, skipDuplicates: true })
  return r.count
}

main().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
