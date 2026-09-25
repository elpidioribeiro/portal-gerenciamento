import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

/**
 * Gera o script de CADASTRO do banco de produção — o que vai por INSERT.
 *
 * O script 8 cria as tabelas vazias. Sem este, a aplicação sobe e **ninguém
 * entra**: `resolverNivel` procura o perfil em `perfil_nivel`, não acha, e
 * recusa o login de todo mundo. As telas abrem sem indicador e sem variável.
 *
 * **O SEED NÃO SERVE PARA ISSO.** `npm run db:seed` também cria usuários
 * fictícios com senha e milhares de ocorrências de Pareto de exemplo — o PLANO
 * é explícito: *"o banco de produção nasce sem seed nenhum"*. O que vai é só o
 * CADASTRO, e é o que este gerador extrai.
 *
 * **Os ids são os mesmos do desenvolvimento**, e isso é deliberado: um id que
 * aparece num relatório, numa URL guardada ou numa conversa continua valendo
 * nos dois ambientes. Gerar ids novos faria os dois divergirem para sempre.
 *
 * O QUE NÃO ENTRA, e por quê:
 *
 *   dimensao_gerencia     vêm da CARGA do Oracle, não do portal. Criá-los aqui
 *   dimensao_area_venda   plantaria linhas que a primeira carga sobrescreve --
 *   dimensao_vendedor     ou pior, duplicaria.
 *
 *   gerencia_variavel     é cadastro do portal, mas aponta para `dimensao_
 *                         gerencia`, que ainda não existe. Só depois da carga.
 *
 *   usuario               nasce no primeiro login de cada pessoa, ou na carga
 *                         de usuários. Plantar aqui criaria linha duplicada.
 *
 * Uso: npx tsx --env-file=.env scripts/gerar-gmud-cadastro.ts
 */

const DESTINO = path.resolve(import.meta.dirname, '..', '..', 'docs', 'gmud')
const ESQUEMA = 'public'
const SEQUENCIAL = '9'
const NOME = 'insere_cadastro_portal_gd'

/**
 * As tabelas, NA ORDEM DE INSERÇÃO.
 *
 * A ordem é a das dependências: uma chave estrangeira não pode apontar para
 * linha que ainda não existe. `ponto_causa` depois de `variavel_controle`,
 * `perfil_variavel` depois de `perfil_nivel` e de `variavel_controle`.
 */
const TABELAS = [
  { nome: 'filial', ordem: 'ordem, sigla' },
  { nome: 'indicador', ordem: 'ordem, codigo' },
  { nome: 'variavel_controle', ordem: 'indicador_id, ordem, nome' },
  /*
   * AGRUPAMENTO ANTES DE PONTO_CAUSA. Na primeira versao estava o contrario, e
   * o script quebraria no DBA: `ponto_causa.bucket_id` referencia
   * `agrupamento(id)`, e a chave estrangeira recusa apontar para linha que
   * ainda nao existe.
   *
   * Conferido contra as FK do script 8, e nao contra a minha leitura do modelo
   * -- era exatamente a leitura que estava errada.
   */
  { nome: 'agrupamento', ordem: 'nivel, ordem, nome' },
  { nome: 'ponto_causa', ordem: 'variavel_controle_id, ordem, nome' },
  { nome: 'perfil_nivel', ordem: 'id_perfil' },
  { nome: 'perfil_variavel', ordem: 'id_perfil, variavel_controle_id' },
  { nome: 'matricula_nivel', ordem: 'matricula' },
] as const

const prisma = new PrismaClient()

/**
 * Literal SQL a partir do valor que o driver devolveu.
 *
 * **Objeto e array precisam de `JSON.stringify`**, e a primeira versao nao
 * tinha: caiam no `String(v)` e viravam `[object Object]`. O Postgres recusou
 * na hora -- *"Token \"object\" is invalid. JSON data, line 1: [object..."* --,
 * e o script morreu no `indicador`, que tem `escala_y` e `regra_status` em
 * `jsonb`.
 *
 * Falhar assim e' o melhor caso: o tipo `jsonb` valida o conteudo. Numa coluna
 * de texto, `[object Object]` teria entrado calado.
 */
function valor(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Date) return `'${v.toISOString()}'`
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
  /*
   * Tipo que eu nao previ. Parar aqui e' melhor do que gerar literal errado: um
   * `[object Object]` num `jsonb` o Postgres recusa, mas numa coluna de texto
   * entraria calado -- foi exatamente assim que o caso do objeto apareceu.
   */
  throw new Error(`valor(): tipo ${typeof v} nao tratado`)
}

const l: string[] = []
const secao = (t: string) => {
  l.push('')
  l.push('-- ' + '='.repeat(76))
  l.push(`-- ${t}`)
  l.push('-- ' + '='.repeat(76))
  l.push('')
}

const resumo: string[] = []

for (const t of TABELAS) {
  const linhas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `select * from ${ESQUEMA}.${t.nome} order by ${t.ordem}`,
  )
  if (linhas.length === 0) {
    console.error(`AVISO: ${t.nome} esta VAZIA no desenvolvimento.`)
    continue
  }
  const colunas = Object.keys(linhas[0]!)
  secao(`${t.nome} - ${String(linhas.length)} linhas`)
  /*
   * Um INSERT por tabela, com todas as linhas. Uma instrucao por linha faria
   * 700 comandos e um log de erro ilegivel; assim, se uma linha violar
   * restricao, o erro aponta a tabela e o script inteiro volta atras -- ele
   * roda em transacao unica.
   */
  l.push(`INSERT INTO ${ESQUEMA}.${t.nome} (${colunas.join(', ')}) VALUES`)
  l.push(
    linhas
      .map((linha) => `  (${colunas.map((c) => valor(linha[c])).join(', ')})`)
      .join(',\n') + ';',
  )
  resumo.push(`${t.nome}: ${String(linhas.length)}`)
}

const cabecalho = `-- Portal GD - cadastro inicial do banco de producao
--
-- GERADO por scripts/gerar-gmud-cadastro.ts a partir do banco de
-- desenvolvimento. Executar DEPOIS do 8-cria_banco_portal_gd.sql.
--
-- POR QUE ELE EXISTE: o script 8 cria as tabelas VAZIAS. Sem este, a aplicacao
-- sobe e NINGUEM ENTRA -- o login procura o perfil da pessoa em \`perfil_nivel\`,
-- nao acha, e recusa. As telas abrem sem indicador e sem variavel de controle.
--
-- O QUE ELE INSERE:
${resumo.map((r) => `--   ${r}`).join('\n')}
--
-- OS IDS SAO OS MESMOS DO DESENVOLVIMENTO, de proposito: um id que aparece num
-- relatorio, numa URL guardada ou numa conversa continua valendo nos dois
-- ambientes. Ids novos fariam os dois divergirem para sempre.
--
-- O QUE NAO ENTRA, e nao e' esquecimento:
--
--   dimensao_gerencia, dimensao_area_venda, dimensao_vendedor
--     Vem da CARGA do Oracle, e nao do portal. Criar aqui plantaria linhas que
--     a primeira carga sobrescreve -- ou duplicaria.
--
--   gerencia_variavel
--     E cadastro do portal, mas aponta para \`dimensao_gerencia\`, que so existe
--     depois da carga. Fica para um passo posterior, pela tela de
--     administracao.
--
--   usuario
--     Nasce no primeiro login de cada pessoa, ou na carga de usuarios. Plantar
--     aqui criaria linha duplicada para a mesma pessoa.
--
-- SEM ON CONFLICT, seguindo os scripts anteriores desta pasta: reexecucao falha
-- alto com violacao de chave, e falhar alto e' o comportamento desejado -- diz
-- que o script ja rodou.
--
-- Recuperacao: ${SEQUENCIAL}-${NOME}-RECUPERA.sql`

mkdirSync(DESTINO, { recursive: true })
const arquivo = path.join(DESTINO, `${SEQUENCIAL}-${NOME}.sql`)
writeFileSync(arquivo, cabecalho + '\n' + l.join('\n') + '\n', 'utf8')

/*
 * O RECUPERA apaga na ordem INVERSA -- filho antes do pai, senao a chave
 * estrangeira recusa a remocao.
 */
const r: string[] = [
  `-- Portal GD - RECUPERA de ${SEQUENCIAL}-${NOME}.sql
--
-- Esvazia as tabelas de cadastro, na ordem inversa da insercao: filho antes do
-- pai, senao a chave estrangeira recusa.
--
-- LEIA ANTES DE EXECUTAR: num banco recem-criado isto e' inofensivo -- e o
-- cenario previsto, desfazer uma GMUD que acabou de rodar. Depois do primeiro
-- uso do portal NAO E': apagar \`ponto_causa\` levaria junto, por cascata ou por
-- recusa, as marcacoes de reuniao e as contramedidas ligadas a elas.
--
-- DELETE e nao TRUNCATE: o TRUNCATE nao respeita chave estrangeira sem CASCADE,
-- e o CASCADE aqui apagaria contramedida sem avisar.`,
  '',
]
for (const t of [...TABELAS].reverse()) r.push(`DELETE FROM ${ESQUEMA}.${t.nome};`)

const arquivoR = path.join(DESTINO, `${SEQUENCIAL}-${NOME}-RECUPERA.sql`)
writeFileSync(arquivoR, r.join('\n') + '\n', 'utf8')

console.log(arquivo)
for (const x of resumo) console.log('  ' + x)
console.log(arquivoR)

await prisma.$disconnect()
