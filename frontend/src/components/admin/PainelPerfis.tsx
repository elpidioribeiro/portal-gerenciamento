import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  adminApi,
  mensagemDeErro,
  type NivelComAcesso,
  type PerfilAdmin,
} from '../../lib/api.js'
import { ExcecoesPorMatricula } from './ExcecoesPorMatricula.js'
import { IconeBusca } from '../ui/Icones.js'
import { CartaoResumo, Estado, tituloDeCargo } from './comuns.js'

/**
 * Classificação dos perfis corporativos em níveis do GD.
 *
 * É a tela que destrava o login real: perfil sem nível é bloqueado, e são
 * centenas de perfis contra um punhado classificado. O trabalho aqui é
 * longo e feito aos poucos, então a tela é organizada para **retomar**: o
 * resumo diz quanto falta, o filtro isola o que falta, e a busca acha um
 * perfil específico entre centenas.
 */

const NIVEIS: NivelComAcesso[] = ['N2', 'N3', 'N4']

/**
 * Teto de linhas desenhadas.
 *
 * 447 linhas com editor embutido em cada uma tornam a digitação na busca
 * perceptivelmente lenta. O corte **não é silencioso**: o rodapé diz quantas
 * ficaram de fora, porque uma lista truncada que se apresenta como completa
 * faria o administrador concluir que um perfil não existe.
 */
const TETO_LINHAS = 60

type Filtro = 'bloqueados' | 'classificados' | 'todos'

export function PainelPerfis() {
  const [filtro, setFiltro] = useState<Filtro>('bloqueados')
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<number | null>(null)

  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'perfis'],
    queryFn: adminApi.perfis,
  })

  const filtrados = useMemo(() => {
    if (!data) return []
    const termo = busca.trim().toLowerCase()

    return data.perfis.filter((p) => {
      if (filtro === 'bloqueados' && p.nivel !== null) return false
      if (filtro === 'classificados' && p.nivel === null) return false
      if (!termo) return true
      // Busca no id e em TODOS os cargos, não só no primeiro: um perfil de 8
      // cargos seria inencontrável pelos outros sete.
      return (
        String(p.idPerfil).includes(termo) ||
        p.cargos.some((c) => c.toLowerCase().includes(termo)) ||
        (p.descricao?.toLowerCase().includes(termo) ?? false)
      )
    })
  }, [data, filtro, busca])

  if (isPending) return <Estado texto="Carregando o catálogo de perfis…" />
  if (error) return <Estado texto={mensagemDeErro(error, 'carregar os perfis')} erro />

  const mostrados = filtrados.slice(0, TETO_LINHAS)
  const escondidos = filtrados.length - mostrados.length

  /**
   * Cargos que aparecem em mais de um perfil.
   *
   * Serve para pré-preencher a descrição: "GERENTE ADJUNTO" sozinho não
   * distingue os perfis 16, 17, 18 e 19, então nesses casos a sugestão inclui a
   * lotação. Calculado sobre o catálogo INTEIRO, não sobre o filtrado — a
   * ambiguidade existe independentemente do que está em tela.
   */
  const cargosRepetidos = new Set(
    Object.entries(
      data.perfis.reduce<Record<string, number>>((conta, p) => {
        for (const c of p.cargos) conta[c] = (conta[c] ?? 0) + 1
        return conta
      }, {}),
    )
      .filter(([, n]) => n > 1)
      .map(([cargo]) => cargo),
  )

  return (
    <div className="flex flex-col gap-5">
      {/*
        As exceções vêm ANTES da tabela de perfis, e não depois: elas VENCEM o
        que a tabela diz. Quem lê a lista de perfis sem ter visto as exceções
        conclui coisa errada sobre quem entra como o quê.
      */}
      <ExcecoesPorMatricula />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoResumo rotulo="Perfis no RH" valor={data.resumo.total} />
        <CartaoResumo rotulo="Classificados" valor={data.resumo.classificados} tom="ok" />
        <CartaoResumo rotulo="Bloqueados" valor={data.resumo.bloqueados} tom="critico" />
        <CartaoResumo
          rotulo="Pessoas sem acesso"
          valor={data.resumo.pessoasBloqueadas}
          tom="critico"
          nota="não entram no portal hoje"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-controle border border-borda bg-superficie p-[3px]">
          {(
            [
              ['bloqueados', `Bloqueados (${data.resumo.bloqueados})`],
              ['classificados', `Classificados (${data.resumo.classificados})`],
              ['todos', `Todos (${data.resumo.total})`],
            ] as const
          ).map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFiltro(v)}
              aria-pressed={filtro === v}
              className={[
                'rounded-botaoPequeno px-3 py-[6px] text-legenda font-semibold transition-colors duration-hover',
                filtro === v
                  ? 'bg-navy text-white'
                  : 'text-texto-sec hover:bg-superficie-hover hover:text-texto',
              ].join(' ')}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <label className="relative flex flex-1 items-center">
          <span className="absolute left-3 flex items-center">
            <IconeBusca tamanho={14} cor="#8592A8" />
          </span>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cargo, id do perfil ou descrição"
            className="w-full rounded-campo border border-borda bg-superficie py-[9px] pl-9 pr-3 text-corpo text-texto placeholder:text-texto-off focus:border-borda-hover focus:outline-none"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-borda bg-superficie-header">
              <Th largura="w-[72px]">Perfil</Th>
              <Th>Cargo no RH</Th>
              {/* A lotação não é mais parte da chave (§7.20), mas continua na
                  tabela: é ela que diz QUAL dos quatro "GERENTE ADJUNTO" é
                  este, e sem ela são quatro linhas de mesmo cargo. */}
              <Th>Lotação</Th>
              <Th largura="w-[88px]" alinhar="right">
                Pessoas
              </Th>
              <Th largura="w-[132px]">Nível no GD</Th>
              <Th largura="w-[112px]" alinhar="right">
                {''}
              </Th>
            </tr>
          </thead>
          <tbody>
            {mostrados.map((p) => (
              <Linha
                key={p.idPerfil}
                perfil={p}
                cargoAmbiguo={p.cargos.some((c) => cargosRepetidos.has(c))}
                editando={editando === p.idPerfil}
                onEditar={() => setEditando(p.idPerfil)}
                onFechar={() => setEditando(null)}
              />
            ))}
            {mostrados.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-corpo text-texto-sec">
                  {busca
                    ? `Nenhum perfil casa com "${busca}" neste filtro.`
                    : 'Nenhum perfil neste filtro.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {escondidos > 0 && (
          <p className="border-t border-borda bg-superficie-alt px-4 py-3 text-legenda text-texto-sec">
            Mostrando {mostrados.length} de {filtrados.length}.{' '}
            <span className="font-semibold text-texto">{escondidos} fora da lista</span> — refine a
            busca para alcançá-los.
          </p>
        )}
      </div>
    </div>
  )
}

function Th({
  children,
  largura,
  alinhar = 'left',
}: {
  children: React.ReactNode
  largura?: string
  alinhar?: 'left' | 'right'
}) {
  return (
    <th
      className={[
        'px-4 py-[10px] text-coluna uppercase text-texto-ter',
        alinhar === 'right' ? 'text-right' : 'text-left',
        largura ?? '',
      ].join(' ')}
    >
      {children}
    </th>
  )
}

function Linha({
  perfil,
  cargoAmbiguo,
  editando,
  onEditar,
  onFechar,
}: {
  perfil: PerfilAdmin
  /** O cargo deste perfil também existe em outro. Ver `cargosRepetidos`. */
  cargoAmbiguo: boolean
  editando: boolean
  onEditar: () => void
  onFechar: () => void
}) {
  const outros = perfil.cargos.length - 1

  return (
    <>
      <tr className="border-b border-borda-sutil last:border-b-0 odd:bg-superficie even:bg-superficie-alt">
        <td className="px-4 py-[11px] tabular text-corpo font-semibold text-texto">
          {perfil.idPerfil}
        </td>
        <td className="px-4 py-[11px]">
          <span className="text-corpo text-texto">{perfil.cargos[0]}</span>
          {outros > 0 && (
            <span
              className="ml-2 rounded-full bg-andamento-bg px-2 py-[2px] text-micro font-semibold text-andamento-texto"
              title={perfil.cargos.join('\n')}
            >
              +{outros} cargo{outros > 1 ? 's' : ''}
            </span>
          )}
          {perfil.descricao && (
            <span className="mt-[2px] block text-micro text-texto-ter">{perfil.descricao}</span>
          )}
        </td>
        <td className="px-4 py-[11px]">
          <Lotacoes perfil={perfil} />
        </td>
        <td className="px-4 py-[11px] text-right tabular text-corpo text-texto-sec">
          {perfil.pessoas}
        </td>
        <td className="px-4 py-[11px]">
          <Selo perfil={perfil} />
        </td>
        <td className="px-4 py-[11px] text-right">
          <button
            type="button"
            onClick={editando ? onFechar : onEditar}
            className="rounded-botaoPequeno border border-borda px-3 py-[5px] text-legenda font-semibold text-texto-sec transition-colors duration-hover hover:border-borda-hover hover:text-texto"
          >
            {editando ? 'Fechar' : perfil.nivel ? 'Alterar' : 'Classificar'}
          </button>
        </td>
      </tr>

      {editando && (
        <tr className="border-b border-borda bg-andamento-bg/40">
          <td colSpan={6} className="px-4 py-4">
            <Editor perfil={perfil} cargoAmbiguo={cargoAmbiguo} onPronto={onFechar} />
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * Sugestão de descrição, para não digitar centenas à mão.
 *
 * Acrescenta a lotação **só quando o cargo é ambíguo** — quatro perfis chamados
 * "Gerente Adjunto" precisam de rótulos distintos, mas os 372 perfis de cargo
 * único ficariam com nome inutilmente longo se todos levassem a lotação.
 *
 * Nada disso é obrigatório: o campo é editável, e o cargo do RH nem sempre é o
 * nome que faz sentido no GD.
 */
function sugerirDescricao(perfil: PerfilAdmin, cargoAmbiguo: boolean): string {
  const cargo = tituloDeCargo(perfil.cargos[0] ?? '')
  if (!cargoAmbiguo) return cargo

  const lotacao = perfil.lotacoes.length === 1 ? perfil.lotacoes[0] : null
  if (!lotacao) return cargo

  return `${cargo} · ${tituloDeCargo(lotacao)}`
}

/**
 * A lotação da linha.
 *
 * Uma só (83% dos casos) aparece por extenso, porque é o que identifica o
 * perfil. Várias viram contagem: os dois extremos têm 21 e 27 lotações, e
 * enfileirá-las quebraria a linha da tabela sem informar mais.
 */
function Lotacoes({ perfil }: { perfil: PerfilAdmin }) {
  const primeira = perfil.lotacoes[0]
  if (!primeira) return <span className="text-corpo text-texto-off">—</span>

  if (perfil.lotacoes.length === 1) {
    return <span className="text-corpo text-texto-sec">{primeira}</span>
  }

  return (
    <span
      className="cursor-help text-corpo text-texto-sec underline decoration-borda decoration-dotted underline-offset-2"
      title={perfil.lotacoes.join('\n')}
    >
      {perfil.lotacoes.length} lotações
    </span>
  )
}

/**
 * Selo do estado.
 *
 * Três estados visuais, não dois. "Inativo" precisa se distinguir de "nunca
 * classificado" porque o conserto é diferente: um pede reativar, o outro pede
 * classificar — e o backend devolve os dois com `nivel: null`, já que o efeito
 * no login é o mesmo.
 */
function Selo({ perfil }: { perfil: PerfilAdmin }) {
  if (perfil.nivel) {
    return (
      <span className="inline-flex items-center gap-[6px] rounded-full border border-ok-borda bg-ok-bg px-[10px] py-[3px] text-badge uppercase text-ok-texto">
        <span className="h-[6px] w-[6px] rounded-full bg-ok-ponto" />
        {perfil.nivel}
      </span>
    )
  }

  if (perfil.ativo === false && perfil.descricao !== null) {
    return (
      <span className="inline-flex items-center gap-[6px] rounded-full border border-risco-borda bg-risco-bg px-[10px] py-[3px] text-badge uppercase text-risco-texto">
        <span className="h-[6px] w-[6px] rounded-full bg-risco-ponto" />
        Desligado
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-[6px] rounded-full border border-critico-borda bg-critico-bg px-[10px] py-[3px] text-badge uppercase text-critico-texto">
      <span className="h-[6px] w-[6px] rounded-full bg-critico-ponto" />
      Bloqueado
    </span>
  )
}

function Editor({
  perfil,
  cargoAmbiguo,
  onPronto,
}: {
  perfil: PerfilAdmin
  cargoAmbiguo: boolean
  onPronto: () => void
}) {
  const queryClient = useQueryClient()

  /*
   * O catálogo de variáveis, para o N4 escolher as dele. Vem do banco e não de
   * uma lista no código: virão variáveis OPERACIONAIS, de recebimento,
   * armazenagem e expedição, e uma constante aqui seria mais um lugar para
   * esquecer de atualizar. Ver PLANO §7.18.
   */
  const { data: catalogo } = useQuery({
    queryKey: ['admin', 'variaveis'],
    queryFn: adminApi.variaveis,
  })

  const [nivel, setNivel] = useState<NivelComAcesso>(perfil.nivel ?? 'N4')
  /*
   * As VARIÁVEIS são o que o N4 pode MARCAR, e por isso só ele as tem: o N3 lê
   * a filial inteira e o N2 é corporativo. Substituem o conjunto inteiro ao
   * salvar — o que for desmarcado aqui sai.
   */
  const [variaveis, setVariaveis] = useState<Set<string>>(new Set(perfil.variaveis))
  /**
   * Descrição pré-preenchida com o cargo do RH em caixa de título.
   *
   * Poupar digitação em centenas de perfis é o ponto, mas o campo continua
   * editável: o cargo do RH nem sempre é o nome que faz sentido no GD, e um
   * perfil de vários cargos precisa de um rótulo que cubra todos.
   */
  const [descricao, setDescricao] = useState(
    perfil.descricao ?? sugerirDescricao(perfil, cargoAmbiguo),
  )
  const [ativo, setAtivo] = useState(perfil.ativo || perfil.descricao === null)

  function alternar(id: string) {
    setVariaveis((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }

  function recarregar() {
    // Invalida por prefixo: o catálogo mudou, e o resumo do topo lê dele.
    return queryClient.invalidateQueries({ queryKey: ['admin'] })
  }

  const salvar = useMutation({
    mutationFn: () =>
      adminApi.classificar(perfil.idPerfil, {
        nivel,
        // Só o N4 leva variáveis. Mandá-las para N3 ou N2 é recusado pelo
        // servidor, e com razão: seria cadastro que a resolução ignora.
        variaveis: nivel === 'N4' ? [...variaveis] : [],
        descricao,
        ativo,
      }),
    onSuccess: async () => {
      await recarregar()
      onPronto()
    },
  })

  const remover = useMutation({
    mutationFn: () => adminApi.desclassificar(perfil.idPerfil),
    onSuccess: async () => {
      await recarregar()
      onPronto()
    },
  })

  const erro = salvar.error ?? remover.error
  const ocupado = salvar.isPending || remover.isPending
  /*
   * O N4 sem variável entra no portal e clica sem efeito nenhum: ele não
   * responde por variável alguma, então toda marcação é recusada. O servidor
   * também recusa — isto aqui é para o administrador saber ANTES de salvar.
   */
  const faltaVariavel = nivel === 'N4' && variaveis.size === 0

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (descricao.trim() && !faltaVariavel) salvar.mutate()
      }}
    >
      {perfil.cargos.length > 1 && (
        <p className="text-legenda text-texto-sec">
          <span className="font-semibold text-texto">Este perfil cobre {perfil.cargos.length} cargos:</span>{' '}
          {perfil.cargos.join(' · ')}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <fieldset className="flex flex-col gap-[6px]">
          <legend className="text-eyebrow uppercase text-texto-ter">Nível</legend>
          <div className="flex rounded-controle border border-borda bg-superficie p-[3px]">
            {NIVEIS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNivel(n)}
                aria-pressed={nivel === n}
                className={[
                  'rounded-botaoPequeno px-4 py-[6px] text-legenda font-bold transition-colors duration-hover',
                  nivel === n
                    ? 'bg-navy text-white'
                    : 'text-texto-sec hover:bg-superficie-hover hover:text-texto',
                ].join(' ')}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex min-w-[260px] flex-1 flex-col gap-[6px]">
          <span className="text-eyebrow uppercase text-texto-ter">Descrição no GD</span>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            maxLength={200}
            required
            className="rounded-campo border border-borda bg-superficie px-3 py-[9px] text-corpo text-texto focus:border-borda-hover focus:outline-none"
          />
        </label>

        <label className="flex items-center gap-2 pb-[10px]">
          <input
            type="checkbox"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="h-4 w-4 rounded border-borda text-navy focus:ring-0"
          />
          <span className="text-corpo text-texto-sec">Ativa</span>
        </label>

        <div className="ml-auto flex items-center gap-2 pb-[6px]">
          {perfil.descricao !== null && (
            <button
              type="button"
              onClick={() => remover.mutate()}
              disabled={ocupado}
              className="rounded-controle border border-critico-borda px-4 py-[9px] text-legenda font-semibold text-critico-texto transition-colors duration-hover hover:bg-critico-bg disabled:opacity-50"
            >
              Remover
            </button>
          )}
          <button
            type="submit"
            disabled={ocupado || !descricao.trim() || faltaVariavel}
            className="rounded-controle bg-navy px-5 py-[9px] text-legenda font-bold text-white transition-colors duration-hover hover:bg-navy-hover disabled:opacity-50"
          >
            {ocupado ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      {/*
        As VARIÁVEIS só aparecem no N4, porque só ele marca ponto de causa. A
        empresa não entra: a associação vale para as nove lojas, e quem filtra é
        a filial de quem loga. Ver PLANO §7.20.
      */}
      {nivel === 'N4' && (
        <fieldset className="flex flex-col gap-3 rounded-controle border border-borda-sutil bg-fundo p-3">
          <legend className="px-1 text-eyebrow uppercase text-texto-ter">
            Variáveis de controle
          </legend>
          <p className="text-legenda text-texto-sec">
            O que este perfil acompanha e pode marcar no quadro. A loja sai de quem entra — não se
            cadastra por empresa.
          </p>

          {(catalogo?.indicadores ?? []).map((i) => (
            <div key={i.codigo} className="flex flex-col gap-[6px]">
              <span className="text-micro font-semibold uppercase text-texto-ter">{i.nome}</span>
              <div className="flex flex-wrap gap-2">
                {i.variaveis.map((v) => {
                  const marcada = variaveis.has(v.id)
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => alternar(v.id)}
                      aria-pressed={marcada}
                      className={[
                        'rounded-botaoPequeno border px-3 py-[6px] text-legenda font-semibold transition-colors duration-hover',
                        marcada
                          ? 'border-navy bg-navy text-white'
                          : 'border-borda bg-superficie text-texto-sec hover:border-borda-hover hover:text-texto',
                      ].join(' ')}
                    >
                      {v.nome}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {faltaVariavel && (
            <p className="text-legenda text-critico-texto">
              Escolha ao menos uma: sem variável, este perfil entra no portal e não consegue marcar
              nada — sem erro nenhum aparecer.
            </p>
          )}
        </fieldset>
      )}

      {nivel === 'N3' && (
        <p className="text-legenda text-texto-ter">
          O N3 lê a filial inteira — não se cadastra variável de controle para ele.
        </p>
      )}
      {nivel === 'N2' && (
        <p className="text-legenda text-texto-ter">
          O N2 é corporativo e normalmente se cadastra por matrícula, no painel acima — que vence o
          nível do cargo.
        </p>
      )}

      {!ativo && (
        <p className="text-legenda text-risco-texto">
          Classificação desligada bloqueia o login igual a não ter classificação.
        </p>
      )}

      {erro && (
        <p className="rounded-controle border border-critico-borda bg-critico-bg px-3 py-2 text-legenda text-critico-texto">
          {mensagemDeErro(erro, 'salvar a classificação')}
        </p>
      )}
    </form>
  )
}
