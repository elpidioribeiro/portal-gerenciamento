import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

/**
 * Gera o script de CADASTRO da meta de Perdas.
 *
 * POR QUE ESTE SCRIPT EXISTE: a meta de Perdas nao tem fonte automatica. Vendas
 * e NPS vem do Power BI e a de area vem do Oracle -- todas entram pela carga
 * (§7.77). Perdas e Custo tem `daxMeta: null` e `montarMetas: null`: o numero e'
 * decisao da area, e o unico caminho para ele entrar no banco e' cadastro.
 *
 * SO' PERDAS. Custo tambem nao tem fonte, mas a meta dele em desenvolvimento e'
 * a constante 17% para tudo -- placeholder do seed, nao numero validado. Fica
 * de fora ate' a area confirmar.
 *
 * A META E' POR FILIAL E MUDA NO TEMPO: 2025 foi -0,25% uniforme, 2026 varia por
 * loja (ver PLANO 5.x, com teste fixando os valores). Por isso o script carrega
 * cada (filial, ano, mes, valor), e nao um numero unico.
 *
 * RESOLVE POR NOME, nao por id: `INSERT ... SELECT` junta indicador por `codigo`
 * e filial por `sigla`. O script 9 preservou os ids de dev em producao, entao
 * daria para carregar os uuid direto -- mas resolver por nome nao depende dessa
 * suposicao e sobrevive a um id que divergir.
 *
 * Uso: npx tsx --env-file=.env scripts/gerar-gmud-meta-perdas.ts
 */

const DESTINO = path.resolve(import.meta.dirname, '..', '..', 'docs', 'gmud')
const SEQUENCIAL = '12'
const NOME = 'cadastra_meta_perdas_portal_gd'

const prisma = new PrismaClient()

interface LinhaMeta {
  sigla: string
  ano: number
  mes: number
  valor: string
}

const linhas = await prisma.$queryRawUnsafe<LinhaMeta[]>(`
  SELECT f.sigla, m.ano, m.mes, m.valor::text AS valor
    FROM meta m
    JOIN indicador i ON i.id = m.alvo_id
    JOIN filial f    ON f.id = m.filial_id
   WHERE i.codigo = 'perdas' AND m.escopo = 'INDICADOR'
   ORDER BY f.ordem, m.ano, m.mes
`)

if (linhas.length === 0) {
  console.error('Nenhuma meta de Perdas em desenvolvimento. Nada a gerar.')
  await prisma.$disconnect()
  process.exit(1)
}

const filiais = [...new Set(linhas.map((l) => l.sigla))]
const competencias = [...new Set(linhas.map((l) => `${l.ano}-${String(l.mes).padStart(2, '0')}`))].sort()

const valores = linhas
  .map((l) => `  ('${l.sigla}', ${l.ano}, ${l.mes}, ${l.valor})`)
  .join(',\n')

const cabecalho = `-- Portal GD - cadastro da META DE PERDAS
--
-- Rodar DEPOIS do 9-insere_cadastro (que traz indicador e filial): a meta
-- aponta para os dois, e sem eles a insercao nao resolve.
--
-- POR QUE ELE EXISTE: a meta de Perdas nao tem fonte automatica. Vendas, NPS e
-- a meta de area entram pela carga; Perdas e Custo nao -- o numero e' decisao da
-- area, e o unico caminho para ele entrar no banco e' cadastro. Sem esta meta,
-- a celula de Perdas no quadro fica cinza ("sem meta") e nao julga nada.
--
-- SO' PERDAS. A meta de Custo tambem falta, mas ainda nao foi definida pela
-- area -- entra num script proprio quando houver numero.
--
-- ${String(linhas.length)} linhas: ${String(filiais.length)} filiais x ${String(competencias.length)} competencias (${competencias[0]} a ${competencias[competencias.length - 1]}).
-- A meta e' por filial e muda no tempo -- por isso cada (filial, ano, mes, valor),
-- e nao um numero unico.
--
-- RESOLVE POR NOME (sigla da filial, codigo do indicador), entao independe dos
-- ids. SEM ON CONFLICT, como os scripts 8 e 9: reexecucao falha alto na chave
-- unica (escopo, alvo, filial, ano, mes), e falhar alto diz que ja' rodou.
--
-- Recuperacao: ${SEQUENCIAL}-${NOME}-RECUPERA.sql

BEGIN;

-- gen_random_uuid() no id: a coluna nao tem default no banco -- o Prisma gera
-- o uuid na aplicacao, nao o Postgres. Um INSERT sem id falha com
-- "null value in column id".
INSERT INTO public.meta (id, escopo, alvo_id, filial_id, ano, mes, valor)
SELECT gen_random_uuid(), 'INDICADOR'::escopo_meta_type, i.id, f.id, v.ano, v.mes, v.valor
  FROM (VALUES
${valores}
       ) AS v(sigla, ano, mes, valor)
  JOIN public.indicador i ON i.codigo = 'perdas'
  JOIN public.filial    f ON f.sigla  = v.sigla;

-- Conferencia: esperado ${String(linhas.length)} linhas de meta de Perdas.
SELECT count(*) AS metas_de_perdas
  FROM public.meta m
  JOIN public.indicador i ON i.id = m.alvo_id
 WHERE i.codigo = 'perdas' AND m.escopo = 'INDICADOR';

COMMIT;
`

mkdirSync(DESTINO, { recursive: true })
const arquivo = path.join(DESTINO, `${SEQUENCIAL}-${NOME}.sql`)
writeFileSync(arquivo, cabecalho, 'utf8')

const recupera = `-- Portal GD - RECUPERA de ${SEQUENCIAL}-${NOME}.sql
--
-- Apaga SO' a meta de Perdas (escopo INDICADOR), e nada mais. E' cadastro puro:
-- nenhuma marcacao, contramedida ou fato depende dela, entao desfazer e' seguro
-- em qualquer momento -- a celula de Perdas apenas volta a "sem meta".

BEGIN;

DELETE FROM public.meta m
 USING public.indicador i
 WHERE m.alvo_id = i.id
   AND i.codigo = 'perdas'
   AND m.escopo = 'INDICADOR';

SELECT count(*) AS metas_de_perdas_restantes
  FROM public.meta m
  JOIN public.indicador i ON i.id = m.alvo_id
 WHERE i.codigo = 'perdas' AND m.escopo = 'INDICADOR';

COMMIT;
`
const arquivoR = path.join(DESTINO, `${SEQUENCIAL}-${NOME}-RECUPERA.sql`)
writeFileSync(arquivoR, recupera, 'utf8')

console.log(arquivo)
console.log(`  ${String(linhas.length)} linhas — ${String(filiais.length)} filiais × ${String(competencias.length)} competências`)
console.log(arquivoR)

await prisma.$disconnect()
