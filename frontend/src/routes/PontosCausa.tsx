import { useState } from 'react'
import { usePeriodo } from '../contexts/PeriodoContext.js'
import { mensagemDeErro } from '../lib/api.js'
import { contar, ROTULO_NIVEL } from '../lib/rotulos.js'
import { usePontosCausaRede, type PontosCausaRede } from '../hooks/usePontosCausaRede.js'

/**
 * PONTOS DE CAUSA DA REDE — a tela do N2.
 *
 * O Pareto da reunião responde *"nesta gerência, nesta variável, o que mais
 * apareceu?"*. Esta responde a pergunta que só o N2 faz: **o mesmo problema
 * está travando quantas lojas?** Um ponto com 84 marcações em nove filiais é
 * assunto de rede; os mesmos 84 numa filial só são assunto daquela loja — e o
 * número sozinho não distingue os dois casos. Por isso ALCANCE (em quantas
 * filiais, em quantos GDs) aparece ao lado de toda contagem aqui.
 *
 * A tela não marca nada: quem marca é o N4, na reunião dele. Esta é de
 * leitura — e é por isso que não há nenhum botão de editar.
 */
export function PontosCausa() {
  /** Nulo = mês inteiro. */
  const [semana, setSemana] = useState<number | null>(null)
  /** Nulo = todos os GDs. */
  const [gd, setGd] = useState<string | null>(null)

  const { data, isPending, error } = usePontosCausaRede({ semana, gd })

  return (
    <div className="flex flex-col gap-7">
      <TiraDeGds lista={data?.gds ?? []} atual={gd} trocar={setGd} />

      <Cabecalho dados={data ?? null} semana={semana} escolherSemana={setSemana} />

      {isPending && <Estado texto="Carregando pontos de causa…" />}
      {error && <Estado texto={mensagemDeErro(error, 'carregar os pontos de causa')} erro />}

      {data && data.resumo.total === 0 && <Vazio dados={data} gd={gd} />}

      {data && data.resumo.total > 0 && (
        <>
          <Resumo dados={data} />
          <TabelaDaRede dados={data} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <PorFilial dados={data} />
            <PorGd dados={data} />
          </div>
        </>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   A tira de GDs
   ───────────────────────────────────────────────────────────────────────── */

/**
 * De qual Gerenciamento Diário são os pontos — com "Todos os GDs" na frente.
 *
 * **Aba de GD sem marcação continua clicável**, e de propósito: "nenhuma
 * marcação em Perdas neste ciclo" é uma resposta, e some se a aba não existir.
 * A contagem ao lado do nome é o que evita o clique inútil sem esconder nada.
 */
function TiraDeGds({
  lista,
  atual,
  trocar,
}: {
  lista: PontosCausaRede['gds']
  atual: string | null
  trocar: (codigo: string | null) => void
}) {
  if (lista.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-borda pb-1">
      <span className="text-eyebrow uppercase text-texto-ter">Gerenciamento diário de</span>
      <div className="flex flex-wrap items-stretch gap-1">
        <AbaGd ativa={atual === null} aoClicar={() => trocar(null)}>
          Todos os GDs
        </AbaGd>
        {lista.map((g) => (
          <AbaGd key={g.codigo} ativa={atual === g.codigo} aoClicar={() => trocar(g.codigo)}>
            {g.nome}
            {/*
              A contagem só aparece quando é ZERO.
              Repetir o número em toda aba competiria com a tabela, que é onde
              ele mora; o que a aba precisa dizer é qual delas está vazia, para
              ninguém clicar procurando o que não tem.
            */}
            {g.quantidade === 0 && <span className="ml-[6px] text-texto-off">· 0</span>}
          </AbaGd>
        ))}
      </div>
    </div>
  )
}

function AbaGd({
  ativa,
  aoClicar,
  children,
}: {
  ativa: boolean
  aoClicar: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-pressed={ativa}
      className={[
        'border-b-[3px] px-4 pb-[10px] pt-2 text-corpo transition-colors duration-hover',
        ativa
          ? 'border-escala-ponto font-bold text-texto'
          : 'border-transparent font-medium text-texto-sec hover:text-texto',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Cabeçalho
   ───────────────────────────────────────────────────────────────────────── */

function Cabecalho({
  dados,
  semana,
  escolherSemana,
}: {
  dados: PontosCausaRede | null
  semana: number | null
  escolherSemana: (s: number | null) => void
}) {
  const { rotuloLongo } = usePeriodo()

  /*
   * "S1 a S4 apuradas" quando são várias, "S1 apurada" quando é uma, e nada
   * quando nenhuma fechou -- a frase tem de valer no dia 2 do mês, que é
   * justamente quando ela seria mais fácil de escrever errado.
   */
  const apuradas = (dados?.semanas ?? []).filter((s) => s.situacao === 'APURADA')
  const faixa =
    apuradas.length === 0
      ? 'nenhuma semana fechada ainda'
      : apuradas.length === 1
        ? `S${String(apuradas[0]?.semana)} apurada`
        : `S${String(apuradas[0]?.semana)} a S${String(apuradas[apuradas.length - 1]?.semana)} apuradas`

  return (
    <div className="flex flex-wrap items-start justify-between gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-eyebrow uppercase text-texto-ter">
          {dados ? dados.visao.nivel : ''}
          {dados ? ` · ${ROTULO_NIVEL[dados.visao.nivel] ?? ''}` : ''}
          {dados ? ` · ${contar(dados.visao.filiais, 'filial', 'filiais')}` : ''}
          {dados ? ` · ${contar(dados.gds.length, 'GD', 'GDs')}` : ''}
        </span>
        <h1 className="flex flex-wrap items-baseline gap-[10px] text-titulo-tela">
          Pontos de causa
          <span className="text-corpo font-medium text-texto-ter">Reunião diária</span>
        </h1>
        <p className="text-corpo text-texto-sec">
          {rotuloLongo.charAt(0).toUpperCase() + rotuloLongo.slice(1)}
          {dados ? ` · ${faixa}` : ''}
        </p>
      </div>

      <SeletorSemana
        semanas={dados?.semanas ?? []}
        atual={semana}
        escolher={escolherSemana}
      />
    </div>
  )
}

/**
 * MÊS INTEIRO ou uma semana.
 *
 * A semana FUTURA fica desabilitada em vez de escondida: o ciclo tem cinco
 * semanas o mês todo, e sumir com elas faria a régua encolher a cada segunda —
 * quem olha perderia a referência de onde está no mês. Desabilitada, ela diz
 * "existe e ainda não chegou".
 */
function SeletorSemana({
  semanas,
  atual,
  escolher,
}: {
  semanas: PontosCausaRede['semanas']
  atual: number | null
  escolher: (s: number | null) => void
}) {
  return (
    <div className="flex flex-col items-end gap-[6px]">
      <span className="text-eyebrow uppercase text-texto-ter">Semana</span>
      <div className="flex flex-wrap items-center justify-end gap-[6px]">
        <Botao ativo={atual === null} aoClicar={() => escolher(null)}>
          Mês inteiro
        </Botao>
        {semanas.map((s) => (
          <Botao
            key={s.semana}
            ativo={atual === s.semana}
            desabilitado={s.situacao === 'FUTURA'}
            titulo={
              s.situacao === 'FUTURA'
                ? 'Esta semana ainda não começou'
                : s.situacao === 'EM_ANDAMENTO'
                  ? 'Semana em andamento — ainda pode receber marcação'
                  : undefined
            }
            aoClicar={() => escolher(s.semana)}
          >
            S{s.semana}
          </Botao>
        ))}
      </div>
    </div>
  )
}

function Botao({
  ativo,
  desabilitado = false,
  titulo,
  aoClicar,
  children,
}: {
  ativo: boolean
  desabilitado?: boolean
  titulo?: string | undefined
  aoClicar: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      disabled={desabilitado}
      aria-pressed={ativo}
      {...(titulo !== undefined ? { title: titulo } : {})}
      className={[
        'h-[34px] rounded-[9px] border px-[14px] text-legenda font-bold transition-colors duration-hover',
        ativo
          ? 'border-navy bg-navy text-white'
          : desabilitado
            ? 'cursor-not-allowed border-borda-clara bg-superficie text-texto-off'
            : 'border-borda bg-superficie-alt text-texto-ter hover:border-borda-hover',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Os três cartões
   ───────────────────────────────────────────────────────────────────────── */

function Resumo({ dados }: { dados: PontosCausaRede }) {
  const pico = [...dados.semanas].sort((a, b) => b.quantidade - a.quantidade)[0]
  const maior = dados.pontos[0]

  /*
   * A SEMANA CORRENTE não é "sem apuração", e juntá-las mentia.
   *
   * A nota dizia "S2, S3, S4, S5 sem apuração" enquanto a barra da S2 mostrava
   * 7 marcações logo acima. Uma das duas estava errada, e era a frase: a S2
   * está em ANDAMENTO — tem número, e ele ainda vai crescer. O que não tem
   * apuração é a semana que nem começou.
   */
  const emAndamento = dados.semanas.filter((s) => s.situacao === 'EM_ANDAMENTO')
  const futuras = dados.semanas.filter((s) => s.situacao === 'FUTURA')
  const listar = (ss: typeof dados.semanas) => ss.map((s) => `S${String(s.semana)}`).join(', ')

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card titulo="Pontos marcados no ciclo">
        <div className="flex flex-wrap items-baseline gap-[10px]">
          <span className="tabular text-kpi text-texto">{dados.resumo.total}</span>
          <span className="text-corpo text-texto-sec">
            em {contar(dados.ciclo.semanasApuradas, 'semana apurada', 'semanas apuradas')}
          </span>
        </div>
        {/*
          O RITMO das semanas fechadas — e ele não é `total ÷ apuradas`.

          O total inclui a semana em andamento; o divisor não a conta. O
          servidor soma só o que as fechadas marcaram, justamente para os dois
          lados da divisão virem do mesmo universo. Aqui a tela só precisa
          dizer de onde saiu — "nas fechadas" —, senão o 14 ao lado de um total
          de 21 parece conta errada.
        */}
        <div className="flex flex-wrap items-baseline gap-[10px] text-corpo">
          {dados.resumo.porSemanaApurada === null ? (
            <span className="text-texto-ter">
              {dados.ciclo.semana === null
                ? 'Nenhuma semana fechou ainda — sem ritmo para comparar'
                : `Recorte da S${String(dados.ciclo.semana)}`}
            </span>
          ) : (
            <>
              <span className="tabular font-bold text-texto">
                {dados.resumo.porSemanaApurada.toString().replace('.', ',')}
              </span>
              <span className="text-texto-sec">por semana nas fechadas</span>
              <span className="text-texto-ter">· sem meta — sem farol</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-[6px] pt-1">
          <Etiqueta>{contar(dados.resumo.pontosDistintos, 'ponto de causa', 'pontos de causa')}</Etiqueta>
          <Etiqueta>
            {contar(dados.resumo.filiaisQueMarcaram, 'filial marcou', 'filiais marcaram')}
          </Etiqueta>
        </div>
      </Card>

      <Card titulo="Semana de pico">
        <div className="flex flex-wrap items-baseline gap-[10px]">
          <span className="tabular text-kpi text-texto">
            {pico && pico.quantidade > 0 ? `S${String(pico.semana)}` : '—'}
          </span>
          <span className="text-corpo text-texto-sec">
            {pico && pico.quantidade > 0 ? `${String(pico.quantidade)} pontos` : 'sem marcação'}
          </span>
        </div>
        <BarrasDaSemana semanas={dados.semanas} />
        <p className="text-legenda text-texto-ter">
          Eixo de zero a {Math.max(...dados.semanas.map((s) => s.quantidade), 0)}
          {emAndamento.length > 0 && ` · ${listar(emAndamento)} em andamento`}
          {futuras.length > 0 && ` · ${listar(futuras)} sem apuração`}
        </p>
      </Card>

      <Card titulo="Ponto que mais afeta a rede">
        {maior ? (
          <>
            <p className="text-titulo-secao text-texto">{maior.nome}</p>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-corpo text-texto-sec">
              <span>
                <span className="tabular font-bold text-texto">{maior.quantidade}</span> marcações
              </span>
              <span>
                <span className="tabular font-bold text-texto">
                  {maior.percentual.toFixed(1).replace('.', ',')}%
                </span>{' '}
                do total
              </span>
              <span>
                <span className="tabular font-bold text-texto">
                  {maior.filiais} de {dados.visao.filiais}
                </span>{' '}
                filiais
              </span>
            </div>
            <p className="border-t border-borda-divisor pt-3 text-legenda text-texto-ter">
              {/*
                O ALCANCE em palavras, porque é ele que decide se o assunto é da
                rede ou de uma loja. Os mesmos 21 pontos numa filial só não são
                um problema de rede -- e o número sozinho não separa os dois.
              */}
              {maior.filiais === dados.visao.filiais
                ? `Marcado em todas as ${String(dados.visao.filiais)} filiais`
                : `Concentrado em ${contar(maior.filiais, 'filial', 'filiais')} de ${String(dados.visao.filiais)}`}
              {` · GD de ${maior.gd}`}
            </p>
          </>
        ) : (
          <p className="text-corpo text-texto-sec">Nada marcado neste recorte.</p>
        )}
      </Card>
    </div>
  )
}

/** As cinco semanas em barras, com a de pico em navy e as demais apagadas. */
function BarrasDaSemana({ semanas }: { semanas: PontosCausaRede['semanas'] }) {
  const teto = Math.max(...semanas.map((s) => s.quantidade), 1)

  return (
    <div className="flex items-end gap-[6px] pt-1">
      {semanas.map((s) => {
        const altura = Math.round((s.quantidade / teto) * 100)
        return (
          <div key={s.semana} className="flex flex-1 flex-col items-center gap-[6px]">
            <div
              className="flex h-[44px] w-full items-end rounded-[4px] bg-grade-trilha"
              title={`S${String(s.semana)}: ${String(s.quantidade)} ${s.quantidade === 1 ? 'ponto' : 'pontos'}`}
            >
              <div
                className={`w-full rounded-[4px] ${
                  s.quantidade === teto && teto > 0 ? 'bg-navy' : 'bg-borda-hover'
                }`}
                /*
                 * Altura calculada, e não uma classe: é o dado. `min-h` de 3px
                 * para a semana com marcação não desaparecer no arredondamento
                 * -- uma barra invisível lê como zero, que é outra coisa.
                 */
                style={{ height: `${String(altura)}%`, minHeight: s.quantidade > 0 ? 3 : 0 }}
              />
            </div>
            <span
              className={`text-[9px] font-bold uppercase tracking-[0.1em] ${
                s.situacao === 'FUTURA' ? 'text-texto-off' : 'text-texto-ter'
              }`}
            >
              S{s.semana}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   A tabela
   ───────────────────────────────────────────────────────────────────────── */

function TabelaDaRede({ dados }: { dados: PontosCausaRede }) {
  const teto = dados.pontos[0]?.quantidade ?? 1

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-titulo-secao text-texto">Pontos de causa da rede</h2>
        <p className="text-legenda text-texto-ter">
          Marcações no ciclo, maior primeiro · uma coluna por semana do mês
        </p>
      </div>

      <div className="overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b border-borda bg-superficie-header">
              <Th className="w-[46px] text-center">#</Th>
              <Th>Ponto de causa</Th>
              <Th>Marcações no ciclo</Th>
              <Th className="text-right">% do total</Th>
              <Th className="w-[130px]">Por semana</Th>
              <Th className="text-right">Alcance</Th>
            </tr>
          </thead>
          <tbody>
            {dados.pontos.map((p, i) => (
              <tr
                key={p.pontoCausaId}
                className="border-b border-borda-clara last:border-0 even:bg-superficie-alt"
              >
                <td className="px-4 py-3 text-center text-legenda tabular text-texto-off">{i + 1}</td>
                <td className="px-4 py-3">
                  <span className="text-corpo font-semibold text-texto">{p.nome}</span>
                  {/*
                    O GD ao lado do nome só quando se está vendo TODOS: dentro
                    de um GD ele seria a mesma palavra em todas as linhas.
                  */}
                  {dados.gds.filter((g) => g.quantidade > 0).length > 1 && (
                    <span className="ml-2 text-legenda text-texto-ter">{p.gd}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-[7px] flex-1 rounded-full bg-grade-trilha">
                      <div
                        className="h-full rounded-full bg-navy-medio"
                        style={{ width: `${String(Math.round((p.quantidade / teto) * 100))}%` }}
                      />
                    </div>
                    <span className="tabular w-[42px] shrink-0 text-right text-corpo-forte text-texto">
                      {p.quantidade}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-corpo tabular text-texto-sec">
                  {p.percentual.toFixed(1).replace('.', ',')}%
                </td>
                <td className="px-4 py-3">
                  <MiniSemanas valores={p.porSemana} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Etiqueta>
                    {p.filiais} de {dados.visao.filiais} filiais
                  </Etiqueta>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** A distribuição do ponto pelas semanas — barras e os números, lado a lado. */
function MiniSemanas({ valores }: { valores: number[] }) {
  const teto = Math.max(...valores, 1)

  return (
    <div className="flex items-center gap-[10px]">
      <div className="flex h-[20px] items-end gap-[3px]">
        {valores.map((v, i) => (
          <div
            key={i}
            className={`w-[7px] rounded-[2px] ${v === 0 ? 'bg-borda-clara' : 'bg-navy-medio'}`}
            style={{ height: `${String(Math.max(Math.round((v / teto) * 100), 12))}%` }}
            title={`S${String(i + 1)}: ${String(v)}`}
          />
        ))}
      </div>
      {/*
        `whitespace-nowrap`: medido em 41px de largura para 34px de altura --
        "6-0-0-0-0" quebrando em duas linhas dentro da célula. A sequência das
        semanas só se lê de uma vez; partida ao meio ela vira dois números.
      */}
      <span className="tabular whitespace-nowrap text-legenda text-texto-ter">
        {valores.join('-')}
      </span>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Os dois painéis de baixo
   ───────────────────────────────────────────────────────────────────────── */

function PorFilial({ dados }: { dados: PontosCausaRede }) {
  const teto = dados.porFilial[0]?.quantidade ?? 1

  return (
    <Painel
      titulo="Por filial"
      descricao={`Contagem absoluta no ciclo · a soma fecha com os ${String(dados.resumo.total)} pontos`}
      colunas={['Filial', 'Marcações', 'Ponto mais marcado']}
    >
      {dados.porFilial.map((f) => (
        <tr key={f.sigla} className="border-b border-borda-clara last:border-0">
          <td className="px-4 py-[10px] text-corpo-forte text-texto">{f.sigla}</td>
          <td className="px-4 py-[10px]">
            <div className="flex items-center gap-3">
              <div className="h-[7px] flex-1 rounded-full bg-grade-trilha">
                <div
                  className="h-full rounded-full bg-navy"
                  style={{ width: `${String(Math.round((f.quantidade / teto) * 100))}%` }}
                />
              </div>
              <span className="tabular w-[34px] shrink-0 text-right text-corpo-forte text-texto">
                {f.quantidade}
              </span>
            </div>
          </td>
          <td className="px-4 py-[10px] text-legenda text-texto-sec">
            {f.maisMarcado ? (
              <>
                {f.maisMarcado.nome}
                <span className="tabular text-texto-ter"> · {f.maisMarcado.quantidade}</span>
              </>
            ) : (
              /* "Não marcou" e não um traço: o traço lê como dado faltando, e
                 aqui o dado existe -- é zero, e zero numa filial que participa
                 do ciclo é informação, não ausência. */
              <span className="text-texto-off">Não marcou neste ciclo</span>
            )}
          </td>
        </tr>
      ))}
    </Painel>
  )
}

function PorGd({ dados }: { dados: PontosCausaRede }) {
  const teto = dados.gds[0]?.quantidade ?? 1

  return (
    <Painel
      titulo="Por GD"
      descricao="Quem está marcando ponto no quadro · e em quantas filiais"
      colunas={['GD', 'Marcações', 'Filiais que marcaram']}
    >
      {dados.gds.map((g) => (
        <tr key={g.codigo} className="border-b border-borda-clara last:border-0">
          <td className="px-4 py-[10px] text-corpo-forte text-texto">{g.nome}</td>
          <td className="px-4 py-[10px]">
            <div className="flex items-center gap-3">
              <div className="h-[7px] flex-1 rounded-full bg-grade-trilha">
                <div
                  className="h-full rounded-full bg-navy-medio"
                  style={{ width: `${String(Math.round((g.quantidade / teto) * 100))}%` }}
                />
              </div>
              <span className="tabular w-[34px] shrink-0 text-right text-corpo-forte text-texto">
                {g.quantidade}
              </span>
            </div>
          </td>
          <td className="px-4 py-[10px] text-legenda tabular text-texto-sec">
            {g.quantidade > 0 ? (
              `${String(g.filiais)} de ${String(dados.visao.filiais)}`
            ) : (
              <span className="text-texto-off">Sem reunião marcando</span>
            )}
          </td>
        </tr>
      ))}
    </Painel>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Peças pequenas
   ───────────────────────────────────────────────────────────────────────── */

function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-borda bg-superficie p-5 shadow-card">
      <span className="text-eyebrow uppercase text-texto-ter">{titulo}</span>
      {children}
    </div>
  )
}

function Painel({
  titulo,
  descricao,
  colunas,
  children,
}: {
  titulo: string
  descricao: string
  colunas: string[]
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-titulo-secao text-texto">{titulo}</h2>
        <p className="text-legenda text-texto-ter">{descricao}</p>
      </div>
      <div className="overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr className="border-b border-borda bg-superficie-header">
              {colunas.map((c, i) => (
                <Th key={c} className={i === colunas.length - 1 ? 'text-right' : ''}>
                  {c}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-[10px] text-left text-coluna uppercase text-texto-ter ${className}`}
      scope="col"
    >
      {children}
    </th>
  )
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-botaoPequeno border border-borda bg-superficie-alt px-[9px] py-[3px] text-legenda text-texto-sec">
      {children}
    </span>
  )
}

function Estado({ texto, erro = false }: { texto: string; erro?: boolean }) {
  return (
    <div
      className={`rounded-card border p-5 text-corpo ${
        erro ? 'border-critico-borda bg-critico-bg text-critico-texto' : 'border-borda bg-superficie text-texto-sec'
      }`}
    >
      {texto}
    </div>
  )
}

/**
 * O VAZIO diz por que está vazio, e o motivo muda com o filtro.
 *
 * "Nenhum resultado" sozinho é indistinguível de erro de carga. Aqui os dois
 * casos possíveis são diferentes de verdade: ou ninguém marcou nada no ciclo,
 * ou marcaram noutro GD que não o filtrado — e a saída de cada um é outra.
 */
function Vazio({ dados, gd }: { dados: PontosCausaRede; gd: string | null }) {
  const nomeDoGd = dados.gds.find((g) => g.codigo === gd)?.nome ?? ''
  const ondeTem = dados.gds.filter((g) => g.quantidade > 0)

  return (
    <div className="flex flex-col gap-2 rounded-card border border-borda bg-superficie p-6 shadow-card">
      <p className="text-titulo-card text-texto">
        {gd === null
          ? 'Nenhum ponto de causa marcado neste ciclo'
          : `Nenhuma marcação em ${nomeDoGd} neste ciclo`}
      </p>
      <p className="text-corpo text-texto-sec">
        {gd === null
          ? 'Os pontos de causa são marcados na reunião do N4, na grade da variável de controle. Enquanto nenhuma reunião marcar, esta tela fica sem o que somar.'
          : ondeTem.length > 0
            ? `Neste ciclo houve marcação em ${ondeTem.map((g) => g.nome).join(', ')}.`
            : 'Nenhum GD teve marcação neste ciclo.'}
      </p>
    </div>
  )
}
