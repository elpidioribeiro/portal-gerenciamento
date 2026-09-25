import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  acoesApi,
  mensagemDeErro,
  COR_STATUS,
  ROTULO_STATUS,
  type DetalheAcao,
  type MovimentacaoAcao,
  type NivelAcao,
} from '../lib/api.js'
import { useAcao, useMovimento } from '../hooks/useAcoes.js'
import { dataDoCalendario, dataEHora } from '../lib/formato.js'

const ROTULO_MOVIMENTO: Record<MovimentacaoAcao['tipo'], string> = {
  ESCALACAO: 'Escalada',
  ATUALIZACAO: 'Atualização da ação',
  DIRECIONAMENTO: 'Direcionada',
  CONCLUSAO: 'Concluída',
  FEEDBACK: 'Feedback',
  // Reservado: saiu de uso em 25/08/2026, mas linhas antigas ainda a têm.
  REVISAO: 'Revisada',
  REJEICAO: 'Rejeitada',
}

/** Movimentos que fecham alguma coisa ganham ponto verde na cronologia. */
const FECHA = new Set<MovimentacaoAcao['tipo']>(['ATUALIZACAO', 'CONCLUSAO', 'FEEDBACK'])

/**
 * A rejeição ganha ponto VERMELHO na linha do tempo.
 *
 * Não é decoração: numa ação que subiu e voltou duas vezes, é o único jeito de
 * ver o vai-e-vem passando o olho — e vai-e-vem é o sintoma que a reunião do
 * GD precisa enxergar, porque significa que o problema não achou dono. Sem
 * cor, uma rejeição tem o mesmo peso visual de uma escalação.
 */
const RECUSA = new Set<MovimentacaoAcao['tipo']>(['REJEICAO'])

export function Contramedida() {
  const { codigo = '' } = useParams()
  const { data, isPending, error } = useAcao(codigo)

  if (isPending) return <Aviso texto="Carregando a contramedida…" />
  if (error) return <Aviso texto={mensagemDeErro(error, 'carregar a contramedida')} erro />

  return <Detalhe codigo={codigo} d={data} />
}

/** Qual composer está aberto. Um de cada vez: são movimentos diferentes. */
type Compondo =
  | null
  | 'atualizacao'
  | 'conclusao'
  | 'feedback'
  | 'escalacao'
  | 'direcionamento'
  | 'rejeicao'

function Detalhe({ codigo, d }: { codigo: string; d: DetalheAcao }) {
  const a = d.contramedida
  const [compondo, setCompondo] = useState<Compondo>(null)
  const vencido = a.sla === 'CRITICO' && !a.concluidaEm

  return (
    <div className="flex flex-col gap-5">
      <Link to="/acoes" className="flex items-center gap-2 self-start text-corpo font-semibold text-navy-medio">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Ações
      </Link>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex flex-grow flex-col gap-2.5">
          <span className="text-eyebrow uppercase text-texto-ter">Contramedida · {a.codigo}</span>
          <h1 className="text-titulo-detalhe">{a.titulo}</h1>
          <div className="flex flex-wrap items-center gap-2.5">
            {/*
              A MESMA COR da lista (`COR_STATUS`), e não o chip neutro de antes.
              O chip aqui era cinza para os cinco status: a ação rejeitada saía
              laranja na lista e cinza ao abrir, igual a uma concluída. Mesmo
              estado, mesmo desenho -- nas três telas que o mostram.
            */}
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-badge ${COR_STATUS[a.status]}`}
            >
              {ROTULO_STATUS[a.status]}
            </span>
            {a.indicador && <span className="text-corpo text-texto-sec">Indicador: {a.indicador}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Cartao rotulo="Filial" valor={a.filial} />
          <Cartao rotulo="Nível atual" valor={a.nivelAtual} />
          {/* Estava saindo o ISO cru -- "2026-09-07" no cartão. Ver `dataDoCalendario`. */}
          <Cartao rotulo="Prazo" valor={dataDoCalendario(a.prazo)} alerta={vencido} />
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_356px]">
        <div className="flex flex-col gap-4">
          {/*
            UMA linha do tempo, e a abertura é o primeiro nó dela.

            Eram dois cartões: "Comentário de abertura" em cima e "Histórico de
            movimentações" embaixo. Mas a abertura É o evento mais antigo da
            ação -- tem autor, tem instante e tem texto, exatamente como os
            outros --, e ficava fora da sequência que ela começa. Quem lia
            tinha de juntar as duas metades de cabeça para responder a pergunta
            do GD: *o que foi tentado, e por que não resolveu*.

            O cartão da abertura também repetia "responsável atual", que já
            está no painel à direita.
          */}
          <div className="rounded-card border border-borda bg-superficie p-6 shadow-card">
            <Cronologia
              abertura={{ quem: a.abertaPor.nome, quando: a.criadoEm, texto: a.comentarioAbertura }}
              movimentacoes={d.movimentacoes}
            />
          </div>
        </div>

        <div className="rounded-card border border-borda bg-superficie p-6 shadow-card">
          <Painel codigo={codigo} d={d} compondo={compondo} setCompondo={setCompondo} />
        </div>
      </div>
    </div>
  )
}

function Painel({
  codigo,
  d,
  compondo,
  setCompondo,
}: {
  codigo: string
  d: DetalheAcao
  compondo: Compondo
  setCompondo: (c: Compondo) => void
}) {
  const p = d.permissoes

  if (compondo === 'atualizacao') {
    return (
      <Composer
        titulo="Nova atualização"
        placeholder="O que aconteceu desde a última vez?"
        rotulo="Enviar atualização"
        codigo={codigo}
        enviar={(texto) => acoesApi.atualizar(codigo, { texto })}
        cancelar={() => setCompondo(null)}
        oQue="enviar a atualização"
      />
    )
  }

  if (compondo === 'conclusao') {
    return (
      <Composer
        titulo="Concluir"
        placeholder="O que foi executado?"
        rotulo="Concluir"
        codigo={codigo}
        enviar={(texto) => acoesApi.concluir(codigo, { texto })}
        cancelar={() => setCompondo(null)}
        oQue="concluir a contramedida"
        nota="A ação volta para quem abriu, esperando o feedback."
      />
    )
  }

  if (compondo === 'feedback') {
    return (
      <Composer
        titulo="Seu feedback"
        placeholder="O indicador respondeu? O que você observou desde que a ação foi concluída?"
        rotulo="Enviar feedback"
        codigo={codigo}
        enviar={(texto) => acoesApi.feedback(codigo, { texto })}
        cancelar={() => setCompondo(null)}
        oQue="enviar o feedback"
        nota="Ao enviar, a ação sai da sua lista e entra em Concluídas."
      />
    )
  }

  if (compondo === 'rejeicao') {
    return (
      <Composer
        titulo="Rejeitar"
        /*
         * O placeholder PEDE O QUE FALTA, e não "por que você está rejeitando".
         *
         * Quem recebe de volta precisa saber o que corrigir para tentar de
         * novo. Uma rejeição que só diz "não é minha" devolve o problema e
         * retém a informação, e a próxima tentativa repete o mesmo erro.
         */
        placeholder="Por que esta ação volta, e o que precisa mudar para ela subir de novo?"
        rotulo="Rejeitar e devolver"
        codigo={codigo}
        enviar={(texto) => acoesApi.rejeitar(codigo, { texto })}
        cancelar={() => setCompondo(null)}
        oQue="rejeitar a contramedida"
        nota="A ação volta para quem a passou, e os dias voltam a contar para essa pessoa."
      />
    )
  }

  if (compondo === 'escalacao') {
    return (
      <ComposerEscalar
        codigo={codigo}
        filial={d.contramedida.filial}
        destinos={p.destinosDeEscalacao}
        cancelar={() => setCompondo(null)}
      />
    )
  }

  if (compondo === 'direcionamento') {
    return (
      <ComposerDirecionar
        codigo={codigo}
        filial={d.contramedida.filial}
        cancelar={() => setCompondo(null)}
      />
    )
  }

  /**
   * Quais botões desenhar vem do SERVIDOR, em `permissoes`.
   *
   * Recalcular as regras aqui seria uma segunda cópia que envelhece sozinha e,
   * pior, dá impressão de segurança sem ser — a autorização real continua em
   * cada rota. Ver PLANO §7.2.
   */
  /*
   * A ORDEM É A DO CICLO, e não a da força do botão.
   *
   *   Atualização · Escalar · Rejeitar · Concluir
   *
   * É a sequência em que a reunião realmente decide: presta contas primeiro,
   * e só então escolhe o que fazer com a ação — subir, devolver ou fechar.
   * Concluir fecha, e por isso vem no fim.
   *
   * Antes começava por Concluir, que é o botão mais forte da tela (verde,
   * cheio) e o mais definitivo: pedia a decisão final antes de a pessoa ter
   * dito o que aconteceu.
   *
   * DAR FEEDBACK e DIRECIONAR não entram nessa ordem porque não competem com
   * ela:
   *
   *  - feedback só existe DEPOIS da conclusão, e só para quem abriu (§7.3).
   *    Nesse estado `podeConcluir`, `podeEscalar` e `podeRejeitar` são todos
   *    falsos -- ele nunca aparece ao lado dos quatro, então fica por último
   *    sem disputar posição com ninguém;
   *  - direcionar é do N2, troca o dono no mesmo nível, e é o mais raro.
   */
  const botoes = [
    /*
     * A ATUALIZAÇÃO AGORA TEM PERMISÃO, e ela vem do servidor como as outras.
     *
     * Era incondicional: aparecia em ação concluída, onde o clique voltava 403.
     * Com a rejeição fechando a ação (10/09/2026) o mesmo aconteceria lá --
     * *"a ação rejeitada não deve ter nem atualização da ação"*.
     */
    p.podeAtualizar && {
      rotulo: 'Atualização da ação',
      nota: 'sem soltar a ação',
      classe: 'bg-andamento-bg border-andamento-borda text-andamento-texto',
      ao: () => setCompondo('atualizacao'),
    },
    p.podeEscalar && {
      rotulo: 'Escalar',
      nota: `sobe para o ${p.destinosDeEscalacao.join(' ou ')}`,
      classe: 'bg-escala-bg border-escala-borda text-escala-texto',
      ao: () => setCompondo('escalacao'),
    },
    /*
     * REJEITAR logo depois de ESCALAR: os dois passam a bola -- um para cima,
     * outro de volta --, então a decisão "eu resolvo ou eu passo" se lê num
     * lugar só. Depois de escalar porque devolver é a saída menos desejada
     * das duas: a cadeia de ajuda existe para subir o problema, não para ele
     * descer de novo.
     *
     * Vermelho suave, e não o vermelho cheio do prazo vencido: rejeitar é um
     * movimento legítimo do GD, não um alarme.
     */
    p.podeRejeitar && {
      rotulo: 'Rejeitar',
      nota: 'devolve a quem passou',
      classe: 'bg-critico-bg border-critico-borda text-critico-texto',
      ao: () => setCompondo('rejeicao'),
    },
    p.podeConcluir && {
      rotulo: 'Concluir',
      nota: 'a verificação vem depois',
      classe: 'bg-acao-concluir border-acao-concluir text-white',
      ao: () => setCompondo('conclusao'),
    },
    p.podeDirecionar && {
      rotulo: 'Direcionar',
      nota: 'troca o dono, mesmo nível',
      classe: 'bg-superficie border-borda text-texto-sec',
      ao: () => setCompondo('direcionamento'),
    },
    p.podeDarFeedback && {
      rotulo: 'Dar feedback',
      nota: 'o indicador respondeu?',
      classe: 'bg-navy-medio border-navy-medio text-white',
      ao: () => setCompondo('feedback'),
    },
  ].filter(Boolean) as { rotulo: string; nota: string; classe: string; ao: () => void }[]

  return (
    <>
      <p className="text-eyebrow uppercase text-texto-ter">Responsável atual</p>
      <p className="mt-1 text-corpo-forte">{d.contramedida.responsavel}</p>
      {/*
        QUEM ABRIU, e só quando não foi o próprio responsável.
        
        O N2 abre ação para o N4 (§7.42), e sem esta linha o card aparece no
        quadro dele como se tivesse nascido sozinho. Quando os dois são a mesma
        pessoa a linha não informa nada, e some.
      */}
      {d.contramedida.abertaPor.nome !== d.contramedida.responsavel && (
        <p className="mt-0.5 text-legenda text-texto-ter">
          aberta por {d.contramedida.abertaPor.nome} · {d.contramedida.abertaPor.nivel}
        </p>
      )}
      <div className="mb-4" />
      <p className="mb-2 text-eyebrow uppercase text-texto-ter">O que você pode fazer</p>
      <div className="flex flex-col gap-2.5">
        {botoes.map((b) => (
          <button
            key={b.rotulo}
            type="button"
            onClick={b.ao}
            className={`flex w-full items-center gap-2 rounded-controle border px-4 py-3 text-left text-corpo font-bold ${b.classe}`}
          >
            {b.rotulo}
            <span className="ml-auto text-micro font-medium opacity-75">{b.nota}</span>
          </button>
        ))}
      </div>
    </>
  )
}

/**
 * ESCALAR — o movimento da cadeia de ajuda.
 *
 * Ficou com `ao: () => undefined` desde que a tela nasceu: o botão desenhava, a
 * rota existia, e o clique não fazia nada. Não dava erro nenhum — e é por isso
 * que sobreviveu. Um botão que falha reclama; um botão mudo parece que a pessoa
 * clicou errado.
 *
 * Não cabia no `Composer` de texto porque escalar pede TRÊS coisas, e duas
 * delas o texto não carrega:
 *
 *   destino      para qual nível sobe — vem do servidor, em `destinosDeEscalacao`
 *   responsável  obrigatório quando MUDA de nível (a rota recusa sem ele)
 *   texto        o que já foi tentado, que é o que o nível de cima vai ler
 *
 * **CROSS é a exceção, e ela é regra de negócio.** Escalar para um setor de
 * apoio MANTÉM o responsável: sem isso o N2 mandaria para Suprimentos e
 * perderia o poder de concluir a própria ação, que ficaria sem dono — ninguém
 * em CROSS pode escalar de volta. Por isso o seletor de responsável some ali,
 * em vez de aparecer vazio.
 */
function ComposerEscalar({
  codigo,
  filial,
  destinos,
  cancelar,
}: {
  codigo: string
  filial: string
  destinos: NivelAcao[]
  cancelar: () => void
}) {
  /*
   * Escalar TIRA a ação das mãos de quem escalou, e o detalhe passa a responder
   * 404 -- `carregar()` filtra pelo que a pessoa pode ver. Ficar na página
   * mostrava "Contramedida AC-0143 não existe", que é verdade para ela e lê
   * como erro do sistema.
   *
   * A lista é onde ela deve estar: a ação saiu de lá, e é isso que ela precisa
   * ver acontecendo.
   */
  const navegar = useNavigate()
  const [destino, setDestino] = useState<NivelAcao>(destinos[0]!)
  const [responsavelId, setResponsavelId] = useState('')
  const [texto, setTexto] = useState('')

  const exigeResponsavel = destino !== 'CROSS'

  const destinatarios = useQuery({
    queryKey: ['acoes', 'destinatarios', destino, filial],
    queryFn: () => acoesApi.destinatarios(destino, filial),
    enabled: exigeResponsavel,
  })
  const pessoas = destinatarios.data?.destinatarios ?? []

  /*
   * Trocar o destino zera o responsável: ele era de OUTRA lista. Deixá-lo
   * mandaria a ação para alguém que não aparece mais no seletor -- e o servidor
   * aceitaria, porque o id continua sendo um id válido.
   */
  useEffect(() => {
    setResponsavelId('')
  }, [destino])

  const m = useMovimento(codigo, () =>
    acoesApi.escalar(codigo, {
      texto: texto.trim(),
      destino,
      ...(exigeResponsavel ? { responsavelDestinoId: responsavelId } : {}),
    }),
  )

  const faltaAlgo = !texto.trim() || (exigeResponsavel && !responsavelId)

  return (
    <>
      <p className="mb-2 text-eyebrow uppercase text-texto-ter">Escalar</p>

      {destinos.length > 1 && (
        <label className="mb-3 block">
          <span className="mb-1 block text-micro uppercase text-texto-ter">Para qual nível</span>
          <select
            value={destino}
            onChange={(e) => setDestino(e.target.value as NivelAcao)}
            className="w-full rounded-controle border border-borda bg-superficie px-3 py-2.5 text-corpo"
          >
            {destinos.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}

      {exigeResponsavel ? (
        <label className="mb-3 block">
          <span className="mb-1 block text-micro uppercase text-texto-ter">
            Quem responde no {destino}
          </span>
          <select
            value={responsavelId}
            onChange={(e) => setResponsavelId(e.target.value)}
            disabled={destinatarios.isPending}
            className="w-full rounded-controle border border-borda bg-superficie px-3 py-2.5 text-corpo disabled:bg-fundo"
          >
            <option value="">{destinatarios.isPending ? 'carregando…' : '— escolha —'}</option>
            {pessoas.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome}
                {x.cargo ? ` · ${x.cargo}` : ''}
              </option>
            ))}
          </select>
          {/*
            A frase diz o que FALTA, e mudou em 31/08 porque a primeira versão
            culpava o cadastro errado.

            O perfil corporativo pode estar certo — `id_perfil 11` é N3 e tem
            dez gerentes gerais — e a lista vir vazia assim mesmo: `usuario` só
            ganha linha no PRIMEIRO LOGIN da pessoa (`provider.ts` faz upsert ao
            autenticar). Quem nunca entrou no portal não existe como destino,
            por mais bem cadastrado que esteja no RH.

            Mandar "fale com a administração" faria alguém procurar um cadastro
            que já está certo.
          */}
          {!destinatarios.isPending && pessoas.length === 0 && (
            <span className="mt-1 block text-micro text-critico-texto">
              Ninguém do {destino} desta loja entrou no portal ainda — a pessoa
              só vira destino depois do primeiro login dela.
            </span>
          )}
        </label>
      ) : (
        <p className="mb-3 rounded-controle border border-borda-sutil bg-fundo px-3 py-2.5 text-legenda text-texto-sec">
          A ação continua com você: o CROSS é eixo de apoio, e quem escala para
          lá não solta a responsabilidade.
        </p>
      )}

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="O que já foi tentado, e por que não resolveu neste nível?"
        className="min-h-[110px] w-full resize-y rounded-controle border border-borda px-3 py-2.5 text-corpo"
      />
      {m.error && (
        <p className="mt-2 text-legenda text-critico-texto">
          {mensagemDeErro(m.error, 'escalar a contramedida')}
        </p>
      )}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          disabled={faltaAlgo || m.isPending}
          onClick={() =>
            m.mutate(undefined, { onSuccess: () => void navegar('/acoes') })
          }
          className="rounded-controle bg-navy-medio px-4 py-2.5 text-corpo font-bold text-white disabled:opacity-50"
        >
          {m.isPending ? 'Enviando…' : `Escalar para o ${destino}`}
        </button>
        <button
          type="button"
          onClick={cancelar}
          className="rounded-controle border border-borda bg-superficie px-4 py-2.5 text-corpo font-semibold text-texto-sec"
        >
          Cancelar
        </button>
      </div>
      <p className="mt-3 text-legenda text-texto-sec">
        Escalar não é passar o problema: é dizer o que já foi tentado para quem
        tem alcance que você não tem.
      </p>
    </>
  )
}

/**
 * DIRECIONAR — troca o dono SEM mudar de nível. Só o N2.
 *
 * Tinha o mesmo `ao: () => undefined` do Escalar, pela mesma razão, e sai junto
 * com ele.
 */
function ComposerDirecionar({
  codigo,
  filial,
  cancelar,
}: {
  codigo: string
  filial: string
  cancelar: () => void
}) {
  // Direcionar troca o dono: a ação sai da lista de quem direcionou, como no
  // Escalar acima.
  const navegar = useNavigate()
  const [responsavelId, setResponsavelId] = useState('')
  const [texto, setTexto] = useState('')

  const destinatarios = useQuery({
    queryKey: ['acoes', 'destinatarios', 'N2', filial],
    queryFn: () => acoesApi.destinatarios('N2', filial),
  })
  const pessoas = destinatarios.data?.destinatarios ?? []

  const m = useMovimento(codigo, () =>
    acoesApi.direcionar(codigo, { texto: texto.trim(), responsavelDestinoId: responsavelId }),
  )

  return (
    <>
      <p className="mb-2 text-eyebrow uppercase text-texto-ter">Direcionar</p>
      <label className="mb-3 block">
        <span className="mb-1 block text-micro uppercase text-texto-ter">Para quem</span>
        <select
          value={responsavelId}
          onChange={(e) => setResponsavelId(e.target.value)}
          disabled={destinatarios.isPending}
          className="w-full rounded-controle border border-borda bg-superficie px-3 py-2.5 text-corpo disabled:bg-fundo"
        >
          <option value="">{destinatarios.isPending ? 'carregando…' : '— escolha —'}</option>
          {pessoas.map((x) => (
            <option key={x.id} value={x.id}>
              {x.nome}
              {x.cargo ? ` · ${x.cargo}` : ''}
            </option>
          ))}
        </select>
      </label>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Por que esta ação é de outra pessoa?"
        className="min-h-[110px] w-full resize-y rounded-controle border border-borda px-3 py-2.5 text-corpo"
      />
      {m.error && (
        <p className="mt-2 text-legenda text-critico-texto">
          {mensagemDeErro(m.error, 'direcionar a contramedida')}
        </p>
      )}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          disabled={!texto.trim() || !responsavelId || m.isPending}
          onClick={() => m.mutate(undefined, { onSuccess: () => void navegar('/acoes') })}
          className="rounded-controle bg-navy-medio px-4 py-2.5 text-corpo font-bold text-white disabled:opacity-50"
        >
          {m.isPending ? 'Enviando…' : 'Direcionar'}
        </button>
        <button
          type="button"
          onClick={cancelar}
          className="rounded-controle border border-borda bg-superficie px-4 py-2.5 text-corpo font-semibold text-texto-sec"
        >
          Cancelar
        </button>
      </div>
      <p className="mt-3 text-legenda text-texto-sec">
        O nível não muda — só o dono. Para subir na cadeia de ajuda, use Escalar.
      </p>
    </>
  )
}

function Composer({
  titulo,
  placeholder,
  rotulo,
  enviar,
  cancelar,
  oQue,
  nota,
  codigo,
}: {
  titulo: string
  placeholder: string
  rotulo: string
  enviar: (texto: string) => Promise<unknown>
  cancelar: () => void
  oQue: string
  nota?: string
  codigo: string
}) {
  const [texto, setTexto] = useState('')
  const m = useMovimento(codigo, (t: string) => enviar(t))

  return (
    <>
      <p className="mb-2 text-eyebrow uppercase text-texto-ter">{titulo}</p>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={placeholder}
        className="min-h-[110px] w-full resize-y rounded-controle border border-borda px-3 py-2.5 text-corpo"
      />
      {m.error && (
        <p className="mt-2 text-legenda text-critico-texto">{mensagemDeErro(m.error, oQue)}</p>
      )}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          disabled={!texto.trim() || m.isPending}
          onClick={() => m.mutate(texto.trim(), { onSuccess: cancelar })}
          className="rounded-controle bg-navy-medio px-4 py-2.5 text-corpo font-bold text-white disabled:opacity-50"
        >
          {m.isPending ? 'Enviando…' : rotulo}
        </button>
        <button
          type="button"
          onClick={cancelar}
          className="rounded-controle border border-borda bg-superficie px-4 py-2.5 text-corpo font-semibold text-texto-sec"
        >
          Cancelar
        </button>
      </div>
      {nota && <p className="mt-3 text-legenda text-texto-sec">{nota}</p>}
    </>
  )
}

/**
 * Cronologia, nunca fio aninhado.
 *
 * A reunião dura 15-20 minutos, em pé, em grupo, e a pergunta que ela faz é uma
 * sequência: o que foi tentado e por que não resolveu. Fio aninhado exige
 * navegar, e esconde o tempo decorrido — que é o dado que expõe cadeia travada.
 * Ver PLANO §7.1.
 */
/** Um nó da linha do tempo, já normalizado — a abertura e os movimentos viram a mesma coisa. */
type NoDaLinha = {
  rotulo: string
  autor: string
  quando: string
  texto: string
  /** A cor do ponto. `neutro` é o cinza dos movimentos que só passam a bola. */
  ponto: 'neutro' | 'fecha' | 'recusa'
}

const COR_DO_PONTO: Record<NoDaLinha['ponto'], string> = {
  neutro: 'bg-borda-hover',
  fecha: 'bg-ok-ponto',
  recusa: 'bg-critico-ponto',
}

function Cronologia({
  abertura,
  movimentacoes,
}: {
  abertura: { quem: string; quando: string; texto: string }
  movimentacoes: MovimentacaoAcao[]
}) {
  /**
   * MAIS NOVO PRIMEIRO por padrão, com botão para inverter (10/09/2026).
   *
   * Pedido do analista, em duas partes: *"organize do mais novo para o mais
   * antigo"* e *"coloque o botãozinho para inverter a ordem também"*. O padrão
   * responde a pergunta de quem abre a ação hoje -- *o que aconteceu por
   * último* --, e a ordem crescente continua a um clique, porque a pergunta do
   * GD (*o que foi tentado, e por que não resolveu*) é uma sequência.
   *
   * **A INVERSÃO É DO CLIENTE, e o servidor não muda.** O comentario que estava
   * aqui dizia para consertar a ordem no servidor, e ele estava certo enquanto
   * a ordem era uma decisão unica -- deixou de estar quando ela virou controle
   * de leitura.
   *
   * E mexer no `orderBy` de lá seria pior do que redundante: `origemDaMao`
   * (contramedidas/routes.ts) faz `.reverse()` sobre a ordem crescente para
   * achar o ÚLTIMO repasse. Com a ordem invertida ela acharia o PRIMEIRO, e a
   * ação rejeitada voltaria para quem a passou três mãos atrás -- sem erro
   * nenhum, e só visível para quem recebesse a devolutiva errada. Conferido no
   * código antes de decidir.
   *
   * Aqui a lista é montada em ordem CRESCENTE (a abertura é o primeiro fato) e
   * invertida no fim, quando é o caso: a abertura acompanha a virada em vez de
   * ficar presa no topo, porque ela é um nó da linha como os outros.
   */
  const [maisNovoPrimeiro, setMaisNovoPrimeiro] = useState(true)

  const cronologicos: NoDaLinha[] = [
    {
      rotulo: 'Aberta',
      autor: abertura.quem,
      quando: abertura.quando,
      texto: abertura.texto,
      ponto: 'neutro',
    },
    ...movimentacoes.map((m) => ({
      rotulo: ROTULO_MOVIMENTO[m.tipo],
      autor: m.autor,
      quando: m.criadoEm,
      texto: m.texto,
      ponto: RECUSA.has(m.tipo) ? ('recusa' as const) : FECHA.has(m.tipo) ? ('fecha' as const) : ('neutro' as const),
    })),
  ]

  const nos = maisNovoPrimeiro ? [...cronologicos].reverse() : cronologicos

  return (
    <div className="flex flex-col">
      {/*
        O CABEÇALHO da linha do tempo, com o botão de inverter.
        Veio do pai para cá: quem sabe a ordem é quem a monta, e deixar o
        rótulo lá e o controle aqui separaria os dois.
      */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-eyebrow uppercase text-texto-ter">Linha do tempo</p>
        {/*
          Só aparece com mais de um nó: com a abertura sozinha não há ordem para
          inverter, e um botão que não muda nada ensina a ignorá-lo.

          O rótulo diz o DESTINO do clique, e não o estado atual -- é a mesma
          escolha do "Ver todas" / "Ver resumo" do N4. "Mais antigo primeiro"
          num botão significa "clique para ficar assim".
        */}
        {cronologicos.length > 1 && (
          <button
            type="button"
            onClick={() => setMaisNovoPrimeiro((v) => !v)}
            className="flex items-center gap-1.5 rounded-botaoPequeno border border-borda px-2.5 py-1 text-legenda font-semibold text-texto-sec transition-colors duration-hover hover:border-borda-hover hover:text-texto"
            title={
              maisNovoPrimeiro
                ? 'Mostrar a sequência do começo: como a ação andou'
                : 'Mostrar o que aconteceu por último primeiro'
            }
          >
            <span aria-hidden>{maisNovoPrimeiro ? '↑' : '↓'}</span>
            {maisNovoPrimeiro ? 'Mais antigo primeiro' : 'Mais novo primeiro'}
          </button>
        )}
      </div>

      {nos.map((n, i) => (
        <div key={`${n.quando}-${i}`} className="flex gap-3.5">
          <div className="flex w-2.5 shrink-0 flex-col items-center">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COR_DO_PONTO[n.ponto]}`} />
            {i < nos.length - 1 && <span className="my-1 w-px flex-grow bg-borda-divisor" />}
          </div>
          <div className="flex flex-grow flex-col gap-1.5 pb-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-corpo font-bold">{n.rotulo}</span>
              <span className="text-legenda text-texto-ter">{n.autor}</span>
              {/* Data E hora: a cadeia de ajuda se mede em horas. Ver `dataEHora`. */}
              <span className="ml-auto text-micro tabular text-texto-off">
                {dataEHora(n.quando)}
              </span>
            </div>
            {n.texto && (
              <p className="whitespace-pre-line rounded-r-controle border-l-[3px] border-andamento-borda bg-superficie-header px-3.5 py-2.5 text-corpo">
                {n.texto}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function Cartao({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div
      className={`min-w-[112px] rounded-card border px-4 py-3.5 ${
        alerta ? 'border-critico-borda bg-critico-bg' : 'border-borda bg-superficie'
      }`}
    >
      <p className={`text-eyebrow uppercase ${alerta ? 'text-critico-texto' : 'text-texto-ter'}`}>
        {rotulo}
      </p>
      <p className={`mt-1.5 text-titulo-secao ${alerta ? 'text-critico-texto' : ''}`}>{valor}</p>
    </div>
  )
}

function Aviso({ texto, erro = false }: { texto: string; erro?: boolean }) {
  return (
    <div
      className={`rounded-card border px-6 py-11 text-center text-corpo shadow-card ${
        erro
          ? 'border-critico-borda bg-critico-bg text-critico-texto'
          : 'border-borda bg-superficie text-texto-sec'
      }`}
    >
      {texto}
    </div>
  )
}
