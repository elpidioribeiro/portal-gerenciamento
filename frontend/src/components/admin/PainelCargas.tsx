import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  adminApi,
  mensagemDeErro,
  type ExecucaoCarga,
  type FonteCarga,
  type FonteCadastro,
  type FonteSql,
  type EstadoCadastro,
  /*
   * Renomeado no import: o tipo da resposta e o COMPONENTE desta tela se chamam
   * os dois `PainelCargas`, e a colisão fazia o TypeScript ler o tipo como
   * "typeof componente" (TS2749). Sem o apelido, `PainelCargas['cargaAtual']`
   * não existe.
   */
  type PainelCargas as RespostaCargas,
} from '../../lib/api.js'
import { IconeAtencao, IconeConfere, IconeRelogio } from '../ui/Icones.js'
import { Estado } from './comuns.js'

/**
 * Cargas de origem Oracle: agendamento e disparo manual.
 *
 * Perdas e Movimentação saíram do n8n em 22/08/2026 e passaram a ser lidas do
 * Oracle pelo próprio portal. Com isso o agendamento veio para dentro, e esta
 * tela é onde ele fica visível — antes, saber se a carga rodou exigia abrir o
 * n8n.
 *
 * A carga leva minutos, então o disparo é assíncrono: a tela recebe 202 e passa
 * a acompanhar o histórico. Enquanto há carga em andamento, a consulta se repete
 * a cada 5 segundos; parada, não — atualizar de graça uma tela que ninguém está
 * esperando só gasta banco.
 */

const ATALHOS_DIAS = [3, 7, 30, 60, 90] as const

const ROTULO: Record<FonteSql, string> = {
  perdas: 'Perdas',
  movimentacao: 'Movimentação',
  'vendas-linha': 'Vendas por linha',
  'vendedor-dia': 'Venda do vendedor',
  vendas: 'Vendas',
  nps: 'NPS',
}

/**
 * O rótulo da fonte, ou o CÓDIGO CRU quando ela não está no mapa.
 *
 * Existe para o histórico de execuções, onde `fonte` vem do banco como texto
 * livre: uma fonte nova roda na carga antes de alguém acrescentá-la aqui, e aí
 * o certo é mostrar `logistica-interna` em vez de vazio.
 *
 * Estava escrito `ROTULO[e.fonte as FonteSql] ?? e.fonte`. O `as` afirmava que
 * a chave existe — e com isso o `?? e.fonte` ao lado dele era código morto aos
 * olhos do tipo, e a única coisa viva na execução. O cast aqui é o oposto:
 * ALARGA o mapa para admitir chave desconhecida, que é a verdade.
 */
function rotuloDaFonte(fonte: string): string {
  return (ROTULO as Partial<Record<string, string>>)[fonte] ?? fonte
}

/**
 * Por que a janela de cada fonte é o que é.
 *
 * Era um ternário no JSX -- com duas fontes, "se é perdas, senão movimentação".
 * Com quatro, as novas herdariam a explicação da movimentação: um texto
 * plausível e errado, que é pior que texto nenhum.
 */
const PORQUE_DA_JANELA: Record<FonteSql, string> = {
  perdas:
    'Fixa em código: uma quebra pendente vira aprovada meses depois e altera um dia já fechado, então a janela precisa ser longa.',
  movimentacao:
    'Fixa em código: nota fiscal não se reclassifica meses depois, então 60 dias bastam.',
  'vendas-linha':
    'Fixa em código: é o detalhe que alimenta o quadro do N4, e a retenção do detalhe é de 60 dias.',
  'vendedor-dia':
    'Fixa em código: mesma retenção do detalhe por linha — 60 dias.',
  vendas:
    'Fixa em código: vem do Power BI, e o dataset guarda dois anos — a mesma retenção do portal.',
  nps: 'Fixa em código: vem do Power BI, com a mesma retenção de dois anos.',
}

/**
 * "carga em andamento" — mas dizendo O QUÊ, DE QUANDO e HÁ QUANTO TEMPO.
 *
 * Era só o texto e o ponto pulsando. Numa carga de Oracle isso fica na tela por
 * minutos sem nada acontecer no histórico, porque a linha em `sync_execucao` só
 * nasce depois que a consulta responde — e não havia como distinguir "está
 * trabalhando" de "travou". Medido em 10/09/2026: 13 minutos invisíveis.
 *
 * **Os minutos são o ponto.** O teto do Oracle é de 20 minutos
 * (`ORACLE_TIMEOUT_CARGA_S`), então "há 3 min" e "há 18 min" pedem reações
 * diferentes: uma é esperar, a outra é que está prestes a morrer por timeout.
 *
 * `carga` pode ser nulo mesmo com `emAndamento` verdadeiro: o descritor vive na
 * memória do servidor e um reinício entre o disparo e esta leitura o esquece.
 * Aí a tela volta ao texto antigo, que é a informação que de fato existe —
 * inventar um "há 0 min" seria pior.
 */
function EmAndamento({ carga }: { carga: RespostaCargas['cargaAtual'] }) {
  const minutos =
    carga === null ? null : Math.floor((Date.now() - Date.parse(carga.desde)) / 60_000)

  return (
    <span className="flex flex-wrap items-center gap-2 text-legenda font-semibold text-andamento-texto">
      <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-escala-ponto" />
      {carga === null ? (
        'carga em andamento'
      ) : (
        <>
          <span>
            carregando <strong className="font-bold">{carga.fonte}</strong>
          </span>
          {carga.de !== null && carga.ate !== null && (
            <span className="font-normal text-texto-ter">
              {carga.de.slice(8, 10)}/{carga.de.slice(5, 7)} a {carga.ate.slice(8, 10)}/
              {carga.ate.slice(5, 7)}
            </span>
          )}
          <span className="font-normal text-texto-ter">
            {/* Menos de um minuto vira "agora": "há 0 min" se lê como defeito. */}
            {minutos !== null && minutos < 1 ? 'agora' : `há ${String(minutos)} min`}
          </span>
        </>
      )}
    </span>
  )
}

export function PainelCargas() {
  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'cargas'],
    queryFn: adminApi.cargas,
    // Só insiste enquanto algo está rodando. Ver o comentário no topo.
    refetchInterval: (q) => (q.state.data?.emAndamento ? 5_000 : false),
  })

  if (isPending) return <Estado texto="Carregando o estado das cargas…" />
  if (error) return <Estado texto={mensagemDeErro(error, 'carregar as cargas')} erro />

  const agendamentoDesligado = data.fontes.every((f) => f.proximo === null)

  return (
    <div className="flex flex-col gap-5">
      {agendamentoDesligado && (
        <p className="flex items-start gap-3 rounded-card border border-escala-borda bg-escala-bg px-5 py-3 text-corpo text-escala-texto">
          <IconeAtencao tamanho={16} cor="#C4501B" />
          <span>
            <span className="font-bold">O agendamento está desligado.</span> Perdas e Movimentação
            não estão sendo atualizadas sozinhas. Costuma ser credencial do Oracle ausente no
            ambiente — o log do backend diz qual.
          </span>
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {data.fontes.map((f) => (
          <CartaoFonte key={f.fonte} fonte={f} bloqueado={data.emAndamento} />
        ))}
      </div>

      <SecaoCadastro fontes={data.cadastro} bloqueado={data.emAndamento} />

      <div className="overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-borda bg-superficie-header px-4 py-3">
          <h2 className="text-titulo-card text-texto">Execuções recentes</h2>
          {data.emAndamento && <EmAndamento carga={data.cargaAtual} />}
        </div>

        {data.execucoes.length === 0 ? (
          <p className="px-4 py-8 text-center text-corpo text-texto-sec">
            Nenhuma carga registrada ainda.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-borda-sutil">
                <Th>Quando</Th>
                <Th>Fonte</Th>
                <Th>Janela</Th>
                <Th alinhar="right">Gravadas</Th>
                <Th>Origem</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {data.execucoes.map((e) => (
                <LinhaExecucao key={e.id} execucao={e} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Th({
  children,
  alinhar = 'left',
}: {
  children: React.ReactNode
  alinhar?: 'left' | 'right'
}) {
  return (
    <th
      className={`px-4 py-[9px] text-coluna uppercase text-texto-ter ${
        alinhar === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

/**
 * O horário da carga automática, editável no lugar em que é exibido.
 *
 * Sem modal e sem tela própria: é um campo só, e o valor que se lê é o valor que
 * se edita. Um formulário separado exigiria repetir o horário em dois lugares e
 * abriria a chance de eles discordarem.
 *
 * O horário é no fuso da aplicação, não em UTC — quem digita 03:15 quer 03:15
 * em Recife. O rótulo diz isso, porque num portal que roda em servidor UTC a
 * dúvida é legítima.
 */
function EditorHorario({ fonte }: { fonte: FonteCarga }) {
  const queryClient = useQueryClient()
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(fonte.horario)

  function recarregar() {
    return queryClient.invalidateQueries({ queryKey: ['admin', 'cargas'] })
  }

  const salvar = useMutation({
    mutationFn: () => {
      const [h, m] = valor.split(':')
      return adminApi.salvarHorario(fonte.fonte, { hora: Number(h), minuto: Number(m) })
    },
    onSuccess: async () => {
      await recarregar()
      setEditando(false)
    },
  })

  const restaurar = useMutation({
    mutationFn: () => adminApi.restaurarHorario(fonte.fonte),
    onSuccess: async (r) => {
      setValor(r.horario)
      await recarregar()
      setEditando(false)
    },
  })

  /*
   * Fonte que o portal não agenda não tem horário para editar.
   *
   * O campo continuaria salvando em `carga_agendamento`, e o valor salvo nunca
   * seria lido -- um controle que aceita a mudança e não faz nada. Aqui se diz
   * o que é verdade: o disparo é manual, e quem agenda é outro sistema.
   */
  if (!fonte.agendada) {
    return (
      <span className="flex items-center gap-[6px]">
        <IconeRelogio tamanho={13} cor="#8592A8" />
        disparo manual
      </span>
    )
  }

  if (!editando) {
    return (
      <span className="flex items-center gap-[6px]">
        <IconeRelogio tamanho={13} cor="#8592A8" />
        todo dia às <span className="tabular font-semibold text-texto">{fonte.horario}</span>
        {!fonte.horarioPadrao && (
          <span
            className="rounded-full bg-andamento-bg px-2 py-[1px] text-micro font-semibold text-andamento-texto"
            title={`Alterado${fonte.horarioPor ? ` por ${fonte.horarioPor}` : ''}. O padrão do código é outro.`}
          >
            alterado
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setValor(fonte.horario)
            setEditando(true)
          }}
          className="text-legenda font-semibold text-andamento-texto underline decoration-dotted underline-offset-2 transition-colors duration-hover hover:text-navy"
        >
          mudar
        </button>
      </span>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        type="time"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="rounded-campo border border-borda bg-superficie px-2 py-[3px] text-corpo tabular text-texto focus:border-borda-hover focus:outline-none"
      />
      <span className="text-micro text-texto-ter">horário de Recife</span>
      <button
        type="button"
        onClick={() => salvar.mutate()}
        disabled={salvar.isPending || restaurar.isPending || !valor}
        className="rounded-botaoPequeno bg-navy px-3 py-[4px] text-legenda font-bold text-white transition-colors duration-hover hover:bg-navy-hover disabled:opacity-40"
      >
        {salvar.isPending ? 'Salvando…' : 'Salvar'}
      </button>
      {!fonte.horarioPadrao && (
        <button
          type="button"
          onClick={() => restaurar.mutate()}
          disabled={salvar.isPending || restaurar.isPending}
          className="rounded-botaoPequeno border border-borda px-3 py-[3px] text-legenda font-semibold text-texto-sec transition-colors duration-hover hover:border-borda-hover hover:text-texto disabled:opacity-40"
          title="Apaga a personalização e volta a seguir o horário definido no código."
        >
          Voltar ao padrão
        </button>
      )}
      <button
        type="button"
        onClick={() => setEditando(false)}
        className="text-legenda text-texto-ter transition-colors duration-hover hover:text-texto"
      >
        cancelar
      </button>
      {(salvar.error ?? restaurar.error) && (
        <span className="text-legenda text-critico-texto">
          {mensagemDeErro(salvar.error ?? restaurar.error, 'salvar o horário')}
        </span>
      )}
    </span>
  )
}

/**
 * CADASTRO — um botão, e nada de janela.
 *
 * Estas quatro fontes são retrato: o SQL não recebe `de`/`ate`, e a carga
 * substitui o que havia. Oferecer "últimos N dias" aqui seria um controle que
 * aceita a escolha e a ignora — e a tela já teve dois desses nesta semana.
 *
 * Linhas numa lista, e não cartões como as fontes de janela: cada uma tem UMA
 * informação (quando rodou) e UMA ação. Um cartão por fonte daria a quatro
 * itens simples o mesmo peso visual das duas que têm horário, janela e dois
 * modos de disparo.
 */
function SecaoCadastro({
  fontes,
  bloqueado,
}: {
  fontes: EstadoCadastro[]
  bloqueado: boolean
}) {
  return (
    <div className="overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
      <div className="border-b border-borda bg-superficie-header px-4 py-3">
        <h2 className="text-titulo-card text-texto">Cadastro</h2>
        <p className="mt-[2px] text-legenda text-texto-sec">
          Retrato do Oracle, sem janela de datas. Atualize depois de mexer no cadastro
          corporativo — supervisor de área, lotação de vendedor, calendário.
        </p>
      </div>

      {fontes.map((f) => (
        <LinhaCadastro key={f.fonte} estado={f} bloqueado={bloqueado} />
      ))}
    </div>
  )
}

const ROTULO_CADASTRO: Record<FonteCadastro, { nome: string; oQue: string }> = {
  'vendedor-area': { nome: 'Vendedor e área', oQue: 'quem é vendedor, e em que área' },
  'area-supervisor': { nome: 'Supervisor da área', oQue: 'quem responde por cada área' },
  'vendedor-situacao': { nome: 'Situação e cota', oQue: 'ativo, apto, e a cota do mês' },
  'dias-uteis': { nome: 'Dias úteis', oQue: 'o calendário de cada loja' },
}

function LinhaCadastro({
  estado,
  bloqueado,
}: {
  estado: EstadoCadastro
  bloqueado: boolean
}) {
  const qc = useQueryClient()
  const [erro, setErro] = useState<string | null>(null)
  const r = ROTULO_CADASTRO[estado.fonte]

  const disparar = useMutation({
    mutationFn: () => adminApi.atualizarCadastro(estado.fonte),
    onSuccess: async () => {
      setErro(null)
      await qc.invalidateQueries({ queryKey: ['admin', 'cargas'] })
    },
    onError: (e) => setErro(mensagemDeErro(e, 'atualizar o cadastro')),
  })

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borda-sutil px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-corpo font-semibold text-texto">{r.nome}</p>
        <p className="text-legenda text-texto-ter">{r.oQue}</p>
        {erro && <p className="mt-1 text-legenda text-critico-texto">{erro}</p>}
      </div>

      <div className="flex items-center gap-4">
        <span className="text-right">
          <span className="block text-eyebrow uppercase text-texto-ter">Última carga</span>
          <span className="tabular text-legenda text-texto-sec">
            {estado.ultimaCarga ? formatarQuando(estado.ultimaCarga) : 'nunca'}
          </span>
        </span>
        <button
          type="button"
          onClick={() => disparar.mutate()}
          disabled={bloqueado || disparar.isPending}
          /* `title` explica o bloqueio: um botão cinza sem motivo parece defeito. */
          title={bloqueado ? 'Há uma carga em andamento. Espere ela terminar.' : undefined}
          className="rounded-controle border border-borda bg-superficie px-3 py-[7px] text-legenda font-semibold text-texto transition-colors hover:border-borda-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {disparar.isPending ? 'Enviando…' : 'Atualizar'}
        </button>
      </div>
    </div>
  )
}

function CartaoFonte({ fonte, bloqueado }: { fonte: FonteCarga; bloqueado: boolean }) {
  const queryClient = useQueryClient()
  const [modo, setModo] = useState<'dias' | 'datas'>('dias')
  const [dias, setDias] = useState(7)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')

  const disparar = useMutation({
    mutationFn: () =>
      adminApi.dispararCarga(
        modo === 'dias' ? { fonte: fonte.fonte, dias } : { fonte: fonte.fonte, de, ate },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'cargas'] }),
  })

  const faltaData = modo === 'datas' && (!de || !ate)

  return (
    <div className="flex flex-col gap-4 rounded-card border border-borda bg-superficie p-5 shadow-card">
      <div>
        <h2 className="text-titulo-card text-texto">{ROTULO[fonte.fonte]}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-legenda text-texto-sec">
          <EditorHorario fonte={fonte} />
          <span>·</span>
          {/* A janela não é editável: é regra de negócio, não preferência. O
              título explica, porque o campo ausente ao lado de um editável
              parece esquecimento. */}
          <span
            className="cursor-help underline decoration-borda decoration-dotted underline-offset-2"
            title={PORQUE_DA_JANELA[fonte.fonte]}
          >
            janela de <span className="tabular font-semibold text-texto">{fonte.janelaDias}</span>{' '}
            dias
          </span>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 border-y border-borda-divisor py-3">
        <div>
          <dt className="text-eyebrow uppercase text-texto-ter">Último dia com dado</dt>
          <dd className="mt-[2px] tabular text-corpo-forte text-texto">
            {fonte.ultimoDiaComDado ? formatarDia(fonte.ultimoDiaComDado) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-eyebrow uppercase text-texto-ter">Próxima carga</dt>
          {/*
            "Desligada" e "não é aqui que se agenda" são coisas diferentes, e a
            palavra sozinha não distinguia. Fonte não agendada continua sendo
            carregada -- pelo n8n -- e dizer "desligada" mandaria alguém
            investigar um problema que não existe.
          */}
          <dd className="mt-[2px] tabular text-corpo-forte text-texto">
            {fonte.agendada ? (
              fonte.proximo ? (
                formatarQuando(fonte.proximo)
              ) : (
                'desligada'
              )
            ) : (
              <span
                className="cursor-help text-corpo text-texto-sec underline decoration-borda decoration-dotted underline-offset-2"
                title="Esta fonte continua agendada no n8n. O portal só a dispara à mão — agendar dos dois lados carregaria a mesma janela duas vezes por dia."
              >
                pelo n8n
              </span>
            )}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-3">
        <div className="flex rounded-controle border border-borda bg-superficie p-[3px]">
          {(
            [
              ['dias', 'Últimos N dias'],
              ['datas', 'Período'],
            ] as const
          ).map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              onClick={() => setModo(v)}
              aria-pressed={modo === v}
              className={[
                'flex-1 rounded-botaoPequeno px-3 py-[6px] text-legenda font-semibold transition-colors duration-hover',
                modo === v
                  ? 'bg-navy text-white'
                  : 'text-texto-sec hover:bg-superficie-hover hover:text-texto',
              ].join(' ')}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {modo === 'dias' ? (
          <div className="flex flex-wrap items-center gap-2">
            {ATALHOS_DIAS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDias(n)}
                aria-pressed={dias === n}
                className={[
                  'rounded-botaoPequeno border px-3 py-[5px] text-legenda font-semibold tabular transition-colors duration-hover',
                  dias === n
                    ? 'border-andamento-borda bg-andamento-bg text-andamento-texto'
                    : 'border-borda text-texto-sec hover:border-borda-hover hover:text-texto',
                ].join(' ')}
              >
                {n}d
              </button>
            ))}
            <label className="flex items-center gap-2">
              <span className="text-legenda text-texto-ter">ou</span>
              <input
                type="number"
                min={1}
                max={730}
                value={dias}
                onChange={(e) => setDias(Math.max(1, Math.min(730, Number(e.target.value) || 1)))}
                className="w-[72px] rounded-campo border border-borda bg-superficie px-2 py-[5px] text-corpo tabular text-texto focus:border-borda-hover focus:outline-none"
              />
              <span className="text-legenda text-texto-ter">dias</span>
            </label>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-eyebrow uppercase text-texto-ter">De</span>
              <input
                type="date"
                value={de}
                onChange={(e) => setDe(e.target.value)}
                className="rounded-campo border border-borda bg-superficie px-2 py-[5px] text-corpo tabular text-texto focus:border-borda-hover focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-eyebrow uppercase text-texto-ter">Até</span>
              <input
                type="date"
                value={ate}
                onChange={(e) => setAte(e.target.value)}
                className="rounded-campo border border-borda bg-superficie px-2 py-[5px] text-corpo tabular text-texto focus:border-borda-hover focus:outline-none"
              />
            </label>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => disparar.mutate()}
            disabled={bloqueado || faltaData || disparar.isPending}
            className="rounded-controle bg-navy px-5 py-[9px] text-legenda font-bold text-white transition-colors duration-hover hover:bg-navy-hover disabled:opacity-40"
            title={bloqueado ? 'Já existe uma carga em andamento.' : undefined}
          >
            {disparar.isPending ? 'Disparando…' : 'Carregar agora'}
          </button>
          {/**
           * A janela é confirmada pela RESPOSTA, não pelo que o formulário
           * pediu. O servidor calcula o D-1 e é ele quem decide; exibir o que a
           * tela mandou mentiria se as duas contas divergissem.
           */}
          {disparar.data && (
            <span className="text-legenda text-texto-sec">
              {formatarDia(disparar.data.de)} a {formatarDia(disparar.data.ate)}
              {disparar.data.blocos > 1 && ` · ${disparar.data.blocos} blocos`}
            </span>
          )}
        </div>

        {disparar.data?.aviso && (
          <p className="text-micro text-texto-ter">{disparar.data.aviso}</p>
        )}

        {disparar.error && (
          <p className="rounded-controle border border-critico-borda bg-critico-bg px-3 py-2 text-legenda text-critico-texto">
            {mensagemDeErro(disparar.error, 'disparar a carga')}
          </p>
        )}
      </div>
    </div>
  )
}

function LinhaExecucao({ execucao: e }: { execucao: ExecucaoCarga }) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      <tr className="border-b border-borda-sutil last:border-b-0 odd:bg-superficie even:bg-superficie-alt">
        <td className="px-4 py-[9px] tabular text-legenda text-texto-sec">
          {formatarQuando(e.iniciadoEm)}
        </td>
        <td className="px-4 py-[9px] text-corpo text-texto">
          {rotuloDaFonte(e.fonte)}
        </td>
        <td className="px-4 py-[9px] tabular text-legenda text-texto-sec">
          {formatarDia(e.de)} → {formatarDia(e.ate)}
        </td>
        <td className="px-4 py-[9px] text-right tabular text-corpo text-texto">
          {e.status === 'SUCESSO' ? e.gravadas.toLocaleString('pt-BR') : '—'}
        </td>
        <td className="px-4 py-[9px] text-legenda text-texto-ter">{rotuloDaOrigem(e.origem)}</td>
        <td className="px-4 py-[9px]">
          {e.status === 'ERRO' ? (
            <button
              type="button"
              onClick={() => setAberto((a) => !a)}
              className="inline-flex items-center gap-[6px] rounded-full border border-critico-borda bg-critico-bg px-[10px] py-[3px] text-badge uppercase text-critico-texto"
            >
              <span className="h-[6px] w-[6px] rounded-full bg-critico-ponto" />
              Erro
            </button>
          ) : e.status === 'EM_ANDAMENTO' ? (
            <span className="inline-flex items-center gap-[6px] rounded-full border border-escala-borda bg-escala-bg px-[10px] py-[3px] text-badge uppercase text-escala-texto">
              <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-escala-ponto" />
              Rodando
            </span>
          ) : (
            <span className="inline-flex items-center gap-[6px] text-legenda font-semibold text-ok-texto">
              <IconeConfere tamanho={13} cor="#1B7A44" />
              {duracao(e)}
            </span>
          )}
        </td>
      </tr>
      {aberto && e.erro && (
        <tr className="border-b border-borda bg-critico-bg/40">
          <td colSpan={6} className="px-4 py-3">
            <pre className="overflow-x-auto whitespace-pre-wrap text-micro text-critico-texto">
              {e.erro}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * Traduz o que ficou gravado em `origem_ip`.
 *
 * A coluna guarda coisas diferentes de propósito: IP quando a carga vem de fora
 * (n8n, `npm run recarregar`), `agenda` quando é o agendamento interno, e
 * `admin:<login>` quando alguém clicou. Sem a tradução, a coluna mostraria IP
 * de container e ninguém saberia o que disparou.
 */
function rotuloDaOrigem(origem: string | null): string {
  if (!origem) return '—'
  if (origem === 'agenda') return 'agendamento'
  if (origem.startsWith('admin:')) return origem.slice('admin:'.length)
  return origem
}

function duracao(e: ExecucaoCarga): string {
  if (!e.finalizadoEm) return 'ok'
  const s = (Date.parse(e.finalizadoEm) - Date.parse(e.iniciadoEm)) / 1000
  return s < 60 ? `${s.toFixed(0)}s` : `${Math.floor(s / 60)}min ${Math.round(s % 60)}s`
}

/** `2026-08-21` → `21/08`. A data já vem em ISO puro, sem fuso a converter. */
function formatarDia(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function formatarQuando(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const mesmoDia = d.toDateString() === hoje.toDateString()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return mesmoDia
    ? hora
    : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`
}
