import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  acoesApi,
  mensagemDeErro,
  ROTULO_PRIORIDADE,
  type NivelAcao,
  type Prioridade,
} from "../../lib/api.js";
import { useSessao } from "../../contexts/SessaoContext.js";

/**
 * Abrir contramedida.
 *
 * **A ação nasce de uma CAUSA.** É o elo que fecha o ciclo do GD — indicador →
 * variável → ponto de causa → contramedida — e é por isso que o botão do
 * protótipo fica dentro do Pareto: quem abre dali já viu o número, já viu a
 * causa que pesa mais, e a decisão é sobre ela. Ver PLANO §7.11.
 *
 * O mesmo formulário atende os dois caminhos:
 *
 *  - **do Pareto**, com a causa e a filial já preenchidas e travadas — mudar
 *    a causa ali desfaria a ligação com o que se acabou de discutir;
 *  - **da lista de ações**, em branco, e aí a causa é escolhida aqui.
 *
 * O que a tela NÃO decide: em que níveis se pode abrir, quem pode receber, e
 * quais agrupamentos existem. Tudo vem de `/contramedidas/opcoes`, que lê a
 * mesma política que a criação usa para recusar. Repetir a regra aqui
 * ofereceria uma opção que o servidor nega — com o formulário todo preenchido.
 */

export interface PreAbertura {
  pontoCausaId: string;
  /** Só para exibir: a causa fica travada quando vem do Pareto. */
  pontoCausaNome: string;
  filial: string;
  /**
   * NOME da gerência — vira o agrupamento, a coluna do quadro.
   *
   * Nome e não id porque são coisas diferentes: a gerência é por (filial,
   * nome), com uma linha por loja, e o agrupamento é por (nível, nome), com
   * uma linha para a rede toda. O casamento é pelo nome. Ver PLANO §7.28.
   *
   * Sem correspondência, o campo volta a ser um seletor: um agrupamento
   * escolhido a esmo poria a ação no quadro de outra gerência.
   */
  gerenciaNome?: string;
  /** De onde veio, para o registro: "Pareto · Performance Vendas · TINTAS". */
  origem?: string;
}

/** Prazo padrão: uma semana. O ciclo do GD é semanal, e a data em branco
 *  convida a deixar para depois — que é o oposto de "resolver hoje". */
function daquiUmaSemana(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function AbrirAcao({
  aberto,
  pre,
  onFechar,
}: {
  aberto: boolean;
  /** Preenchimento vindo do Pareto. Ausente = formulário em branco. */
  pre?: PreAbertura;
  onFechar: () => void;
}) {
  const { usuario } = useSessao();
  /** O nível de quem abre — o destino igual a ele é "o próprio nível". */
  const meuNivel = usuario?.nivel ?? null;
  const navegar = useNavigate();
  const qc = useQueryClient();

  const opcoes = useQuery({
    queryKey: ["acoes", "opcoes"],
    queryFn: acoesApi.opcoes,
    // Níveis, filiais e agrupamentos mudam em escala de mês, não de minuto.
    staleTime: 30 * 60_000,
    enabled: aberto,
  });

  const [nivel, setNivel] = useState<NivelAcao | null>(null);
  const [filial, setFilial] = useState<string | null>(null);
  const [causaId, setCausaId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [bucketId, setBucketId] = useState("");
  const [prazo, setPrazo] = useState(daquiUmaSemana);
  const [prioridade, setPrioridade] = useState<Prioridade>("MEDIA");
  const [comentario, setComentario] = useState("");

  /*
   * O padrão é o nível MAIS BAIXO que a pessoa alcança, e não o dela.
   *
   * "Resolver hoje, quando não for possível resolver agora": a ação nasce o
   * mais perto possível de quem vive o problema, e subir é escolha explícita.
   * `niveisQuePodeCriar` devolve do próprio para baixo, então o último é o
   * mais baixo — CROSS fica de fora do padrão por ser eixo de apoio.
   */
  useEffect(() => {
    if (!aberto || !opcoes.data || nivel !== null) return;
    const abaixo = opcoes.data.niveis.filter((n) => n.nivel !== "CROSS");
    setNivel(
      abaixo[abaixo.length - 1]?.nivel ?? opcoes.data.niveis[0]?.nivel ?? null,
    );
  }, [aberto, opcoes.data, nivel]);

  /* A filial vem do Pareto quando há, e da própria pessoa quando ela tem uma. */
  useEffect(() => {
    if (!aberto || filial !== null) return;
    setFilial(pre?.filial ?? usuario?.filial ?? null);
  }, [aberto, filial, pre?.filial, usuario?.filial]);

  useEffect(() => {
    if (pre?.pontoCausaId) setCausaId(pre.pontoCausaId);
  }, [pre?.pontoCausaId]);

  /**
   * O QUE ESTE DESTINO PEDE — tudo vem do servidor, nada é decidido aqui.
   *
   * As quatro respostas saem de `/opcoes`, que as tira da política. A tela
   * chegou a ter `nivel !== 'N2' && nivel !== 'CROSS'` escrito à mão, e a
   * regra passou a existir em dois lugares -- que foi como ela divergiu.
   *
   * O `?? true` de cada uma é conservador de propósito: sem resposta, pede. Um
   * campo a mais atrapalha; um campo a menos manda corpo incompleto e recebe
   * "Requisição inválida" sem dizer o quê.
   */
  const doNivel = opcoes.data?.niveis.find((n) => n.nivel === nivel);
  const exigeResponsavel = doNivel?.exigeResponsavel ?? true;
  const ehCorporativa = doNivel?.ehCorporativa ?? false;
  const exigePontoCausa = doNivel?.exigePontoCausa ?? false;
  const exigeAgrupamento = doNivel?.exigeAgrupamento ?? true;

  /*
   * A loja filtra a lista de destinatários? Não nos níveis corporativos: lá a
   * pessoa não pertence a uma loja, e filtrar esvaziaria a lista.
   */
  const filiaFiltraDestinatarios = nivel !== null && !ehCorporativa;

  const destinatarios = useQuery({
    queryKey: ["acoes", "destinatarios", nivel, filial],
    queryFn: () => acoesApi.destinatarios(nivel!, filiaFiltraDestinatarios ? filial : null),
    enabled:
      aberto &&
      nivel !== null &&
      exigeResponsavel &&
      (!filiaFiltraDestinatarios || filial !== null),
  });

  /**
   * NO PRÓPRIO NÍVEL, o padrão é EU — e a troca continua possível.
   *
   * Antes de §7.72 o campo nem existia no próprio nível: a ação era de quem
   * abria, e ponto. Com o N2 podendo escolher um par, abrir ação para si mesmo
   * passou a exigir um clique que antes não existia -- e o caso comum continua
   * sendo "é minha".
   *
   * Sugerido, não travado: é a mesma decisão que a Gerência já toma no N4, e
   * pelo mesmo motivo -- o padrão acerta quase sempre, e quem sabe que é
   * exceção troca.
   */
  useEffect(() => {
    if (!aberto || nivel === null || nivel !== meuNivel) return
    if (responsavelId !== '' || !usuario) return
    const souEu = destinatarios.data?.destinatarios.find((d) => d.id === usuario.id)
    if (souEu) setResponsavelId(souEu.id)
  }, [aberto, nivel, meuNivel, responsavelId, usuario, destinatarios.data])

  /*
   * Trocar de nível ou de filial invalida quem já estava escolhido: o
   * destinatário era de outra lista. Deixá-lo mandaria a ação para alguém que
   * não aparece mais no seletor — e o servidor aceitaria.
   */
  useEffect(() => {
    setResponsavelId("");
    setBucketId("");
  }, [nivel, filial]);

  /**
   * DESTINO CORPORATIVO: a loja é a corporativa, e não se escolhe.
   *
   * Escrita aqui, e não no envio, porque o campo MOSTRA o valor -- quem abre
   * precisa ver em que loja a ação vai nascer, mesmo sem poder trocar. Preencher
   * só na hora de enviar deixaria a tela dizendo uma coisa e o corpo mandando
   * outra.
   *
   * Ao voltar para um destino de loja, o campo é limpo em vez de guardar
   * "Corporativo": aquele valor não é opção de N3 nem de N4, e a rota o recusa.
   */
  const siglaCorporativa = opcoes.data?.filialCorporativa?.sigla ?? null;
  useEffect(() => {
    if (nivel === null) return;
    if (ehCorporativa) {
      if (siglaCorporativa && filial !== siglaCorporativa) setFilial(siglaCorporativa);
      return;
    }
    if (siglaCorporativa && filial === siglaCorporativa) {
      setFilial(pre?.filial ?? usuario?.filial ?? null);
    }
  }, [nivel, ehCorporativa, siglaCorporativa, filial, pre?.filial, usuario?.filial]);

  /*
   * Os agrupamentos dependem só do NÍVEL -- a loja não entra.
   *
   * Ela entrava enquanto o agrupamento do N4 era a área de venda: eram 73 na
   * rede, e era preciso filtrar para achar as ~20 da sua loja. Agora são as
   * três gerências, iguais em toda a rede, como os setores dos outros níveis.
   */
  const agrupamentos = useQuery({
    queryKey: ["acoes", "agrupamentos", nivel],
    queryFn: () => acoesApi.agrupamentos(nivel!),
    enabled: aberto && nivel !== null,
  });
  const bucketsDoNivel = agrupamentos.data?.agrupamentos ?? [];

  /**
   * A gerência SUGERIDA: a da causa, ou a de quem entrou.
   *
   * Insensível a CAIXA, e só a ela: as duas pontas têm donos diferentes -- a
   * gerência vem da carga de vendas, em caixa alta ("CONSTRUÇÃO"), e o
   * agrupamento é cadastro do portal, escrito para ser lido ("Construção").
   * O acento tem de bater, e são três nomes: aproximar mais do que isso
   * escolheria um quadro sozinho.
   */
  const nomeSugerido = pre?.gerenciaNome ?? opcoes.data?.minhaGerencia ?? null;
  const bucketSugerido = nomeSugerido
    ? (bucketsDoNivel.find(
        (b) => b.nome.localeCompare(nomeSugerido, "pt-BR", { sensitivity: "accent" }) === 0,
      ) ?? null)
    : null;

  /**
   * SUGERE, nunca trava (31/08/2026).
   *
   * Chegou a travar, por algumas horas: a rota devolvia só a gerência de quem
   * pedia e o campo aparecia fixo, como a Loja. O analista corrigiu -- abrir na
   * dele, sim; prendê-lo nela, não. Um gerente de Construção abre ação para Não
   * Construção quando o problema atravessa a fronteira, e ele é quem sabe
   * quando atravessa. A diferença entre as duas versões é a diferença entre
   * economizar um clique e tirar uma decisão.
   *
   * Sugere UMA VEZ por abertura. Sem o `useRef` o efeito reescreveria a escolha
   * a cada renderização, e o campo voltaria sozinho para a gerência dele logo
   * depois de trocado -- um formulário que desfaz o que a pessoa acabou de
   * fazer, sem dizer nada.
   */
  const sugerido = useRef<string | null>(null);
  useEffect(() => {
    if (!aberto) {
      sugerido.current = null;
      return;
    }
    if (bucketSugerido && sugerido.current !== bucketSugerido.id) {
      sugerido.current = bucketSugerido.id;
      setBucketId(bucketSugerido.id);
    }
  }, [aberto, bucketSugerido]);

  const abrir = useMutation({
    mutationFn: () =>
      acoesApi.abrir({
        titulo: titulo.trim(),
        /*
         * OMITE a causa quando não há: ela é obrigatória só no N4, e mandar
         * `""` faria o Zod recusar o corpo antes de a rota poder explicar.
         * Mesma razão do `responsavelId` logo abaixo.
         */
        ...(causaId ? { pontoCausaId: causaId } : {}),
        filial: filial ?? "",
        nivel: nivel!,
        /*
         * OMITE quando não há: no próprio nível a tela não mostra o seletor, e
         * mandar `""` fazia o corpo ser recusado antes de chegar na rota -- a
         * tela dizia "Requisição inválida" sem dizer o quê.
         */
        ...(responsavelId ? { responsavelId } : {}),
        /*
         * OMITE o agrupamento em N2 e N3: quem o escolhe ali é o SERVIDOR, pelo
         * GD da causa. Mandar daqui seria a tela decidindo o que ela não sabe --
         * ela não conhece o catálogo de agrupamentos nem o GD de cada causa.
         */
        ...(bucketId ? { bucketId } : {}),
        prazo,
        prioridade,
        comentarioAbertura: comentario.trim(),
        ...(pre?.origem ? { origem: pre.origem } : {}),
      }),
    onSuccess: async ({ codigo }) => {
      await qc.invalidateQueries({ queryKey: ["acoes"] });
      onFechar();
      // Vai para a ação recém-aberta: quem abre quer conferir o que escreveu,
      // e voltar para a lista obriga a procurá-la no meio das outras.
      void navegar(`/contramedida/${codigo}`);
    },
  });

  if (!aberto) return null;

  /*
   * O CROSS não tem responsável — a ação fica com quem abriu. Exigi-lo aqui
   * bloquearia o envio de um caso que o servidor aceita.
   */
  /*
   * O QUE FALTA para enviar — e cada linha espelha uma regra do servidor.
   *
   * Causa e agrupamento entraram com a condição junto: bloquear o envio por um
   * campo que a rota nem pede deixaria o botão apagado sem nada em vermelho na
   * tela, que é a pior forma de recusar.
   */
  const falta =
    titulo.trim().length < 3 ||
    nivel === null ||
    comentario.trim() === "" ||
    !filial ||
    (exigePontoCausa && causaId === "") ||
    (exigeAgrupamento && bucketId === "") ||
    (exigeResponsavel && responsavelId === "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10"
      role="dialog"
      aria-modal="true"
      aria-label="Abrir contramedida"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="w-full max-w-[720px] rounded-card border border-borda bg-superficie shadow-modal">
        <div className="flex items-start justify-between gap-4 border-b border-borda px-6 py-4">
          <div>
            <h2 className="text-titulo-secao">Abrir contramedida</h2>
            {/*
              A LINHA DE APOIO acompanha a regra do nível — e antes não
              acompanhava. Ela dizia "a ação nasce de um ponto de causa" logo
              acima de um campo rotulado "(opcional)": duas frases da mesma tela
              discordando sobre a mesma coisa, achado no QA de 11/09/2026.
            */}
            <p className="text-legenda text-texto-sec">
              {pre
                ? "A causa e a loja vêm do Pareto que você estava olhando."
                : exigePontoCausa
                  ? "A ação nasce de um ponto de causa — escolha de qual."
                  : "Marcar o ponto de causa é opcional: ele liga a ação ao indicador que a motivou."}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="rounded-controle border border-borda px-3 py-1.5 text-legenda font-semibold text-texto-sec hover:bg-superficie-hover"
          >
            Fechar
          </button>
        </div>

        {opcoes.isPending && (
          <p className="px-6 py-8 text-corpo text-texto-sec">Carregando…</p>
        )}
        {opcoes.error && (
          <p className="px-6 py-8 text-corpo text-critico-texto">
            {mensagemDeErro(opcoes.error, "carregar as opções")}
          </p>
        )}

        {opcoes.data && (
          <form
            className="flex flex-col gap-4 px-6 py-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!falta) abrir.mutate();
            }}
          >
            <Campo rotulo="O que vai ser feito">
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                maxLength={200}
                placeholder="Repor grade de tintas nas gôndolas da ponta"
                className="w-full rounded-campo border border-borda bg-superficie px-3 py-[9px] text-corpo focus:border-borda-hover focus:outline-none"
              />
            </Campo>

            {/*
              A causa vem TRAVADA quando o formulário abre do Pareto: trocá-la
              ali desfaria a ligação com o que se acabou de discutir, e a ação
              apareceria sob uma causa que ninguém levantou na reunião.
            */}
            {/*
              OPCIONAL fora do N4, e o rótulo diz isso.

              O campo continua na tela nos quatro níveis de propósito (decisão
              do analista, 11/09/2026): é o elo que faz a ação aparecer no bloco
              "o que já está sendo feito" ao lado do indicador que a gerou
              (§7.43). Escondê-lo em N2 e N3 tiraria a possibilidade junto com a
              obrigação.
            */}
            <Campo
              rotulo={exigePontoCausa ? "Ponto de causa" : "Ponto de causa (opcional)"}
            >
              {pre ? (
                <p className="rounded-campo border border-borda-sutil bg-fundo px-3 py-[9px] text-corpo text-texto">
                  {pre.pontoCausaNome}
                  <span className="ml-2 text-micro text-texto-ter">
                    do Pareto
                  </span>
                </p>
              ) : (
                <select
                  value={causaId}
                  onChange={(e) => setCausaId(e.target.value)}
                  className="w-full rounded-campo border border-borda bg-superficie px-3 py-[9px] text-corpo focus:border-borda-hover focus:outline-none"
                >
                  <option value="">— escolha —</option>
                  {opcoes.data.causas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.indicador} · {c.variavel} · {c.nome}
                    </option>
                  ))}
                </select>
              )}
            </Campo>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Em que nível">
                <select
                  value={nivel ?? ""}
                  onChange={(e) => setNivel(e.target.value as NivelAcao)}
                  className="w-full rounded-campo border border-borda bg-superficie px-3 py-[9px] text-corpo focus:border-borda-hover focus:outline-none"
                >
                  {opcoes.data.niveis.map((n) => (
                    <option key={n.nivel} value={n.nivel}>
                      {n.nivel}
                    </option>
                  ))}
                </select>
              </Campo>

              {/*
                A LOJA é a de quem está logado, e por isso quase sempre ela
                INFORMA em vez de perguntar.

                Quem tem filial própria tem uma só — `/opcoes` já devolve
                apenas a dele —, e um seletor de uma opção é ruído: parece uma
                escolha que não existe. O seletor sobrevive para o N2, que é
                corporativo e precisa dizer em qual loja a ação nasce.

                Ela não filtra mais os agrupamentos: eles são as gerências, iguais em
                toda a rede. É onde a ação nasce, e onde ela vai ser cobrada.
              */}
              {/*
                DESTINO CORPORATIVO: informa, não pergunta. A ação nasce no
                corporativo, e a loja deixou de ser uma escolha -- ver
                `criacaoEhCorporativa` no servidor, que recusa qualquer outra.
              */}
              {ehCorporativa ? (
                <Campo rotulo="Loja">
                  <p className="rounded-campo border border-borda-sutil bg-fundo px-3 py-[9px] text-corpo text-texto">
                    {opcoes.data.filialCorporativa?.nome ?? "Corporativo"}
                    <span className="ml-2 text-micro text-texto-ter">
                      ação do {nivel} não é de uma loja
                    </span>
                  </p>
                </Campo>
              ) : opcoes.data.filiais.length === 1 || pre ? (
                  <Campo rotulo="Loja">
                    <p className="rounded-campo border border-borda-sutil bg-fundo px-3 py-[9px] text-corpo text-texto">
                      {(() => {
                        const f = opcoes.data.filiais.find(
                          (x) => x.sigla === filial,
                        );
                        return f ? `${f.sigla} · ${f.nome}` : (filial ?? "—");
                      })()}
                      <span className="ml-2 text-micro text-texto-ter">
                        {pre ? "do Pareto" : "a sua"}
                      </span>
                    </p>
                  </Campo>
                ) : (
                  <Campo rotulo="Loja">
                    <select
                      value={filial ?? ""}
                      onChange={(e) => setFilial(e.target.value)}
                      className="w-full rounded-campo border border-borda bg-superficie px-3 py-[9px] text-corpo focus:border-borda-hover focus:outline-none"
                    >
                      <option value="">— escolha —</option>
                      {opcoes.data.filiais.map((f) => (
                        <option key={f.sigla} value={f.sigla}>
                          {f.sigla} · {f.nome}
                        </option>
                      ))}
                    </select>
                  </Campo>
                )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {exigeResponsavel ? (
                <Campo rotulo="Quem responde">
                  <select
                    value={responsavelId}
                    onChange={(e) => setResponsavelId(e.target.value)}
                    disabled={destinatarios.isPending || !destinatarios.data}
                    className="w-full rounded-campo border border-borda bg-superficie px-3 py-[9px] text-corpo disabled:bg-fundo focus:border-borda-hover focus:outline-none"
                  >
                    <option value="">
                      {destinatarios.isPending ? "carregando…" : "— escolha —"}
                    </option>
                    {(destinatarios.data?.destinatarios ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nome}
                        {d.cargo ? ` · ${d.cargo}` : ""}
                      </option>
                    ))}
                  </select>
                  {destinatarios.data?.destinatarios.length === 0 && (
                    <p className="mt-1 text-micro text-risco-texto">
                      Ninguém deste nível nesta loja entrou no portal ainda — a
                      pessoa só vira destino depois do primeiro login dela.
                    </p>
                  )}
                </Campo>
              ) : (
                <Campo rotulo="Quem responde">
                  {/*
                    DOIS motivos para não haver escolha, e eles dizem coisas
                    diferentes — quem lê precisa saber qual está valendo.

                    No CROSS a responsabilidade não muda de mãos. No próprio
                    nível ela é sua porque não se delega para o colega de mesmo
                    degrau: quem manda no trabalho dele é o nível acima.

                    O servidor decide (`exigeResponsavel`, em `/opcoes`) e recusa
                    o contrário na criação. A tela só desenha o que ele disse.
                  */}
                  <p className="rounded-campo border border-borda-sutil bg-fundo px-3 py-[9px] text-corpo text-texto-sec">
                    {nivel === 'CROSS'
                      ? 'Fica com você — o CROSS é eixo de apoio, e a responsabilidade não muda de mãos.'
                      : 'Fica com você — no seu próprio nível a ação é sua. Para indicar outra pessoa, abra no nível abaixo.'}
                  </p>
                </Campo>
              )}

              {/*
                SÓ ONDE ELA É ESCOLHA — N4 (a gerência) e CROSS (o setor).

                Em N2 e N3 o campo saiu: ali a etiqueta é o ASSUNTO, e o assunto
                vem do GD do ponto de causa, deduzido no servidor ("Geral"
                quando não há causa). Perguntar seria pedir que a pessoa repita
                o que acabou de dizer ao escolher a causa -- e abrir espaço para
                as duas respostas discordarem.
              */}
              {exigeAgrupamento && (
              <>
              {/*
                A GERÊNCIA — a coluna do quadro. Sem ela a ação existe e não
                aparece em lugar nenhum, por isso o servidor exige.

                O rótulo diz "Gerência", e não "Agrupamento no quadro": quem
                preenche pensa na gerência dela, não no nome que a tabela dá à
                coluna. `agrupamento` continua sendo o termo do banco, onde ele
                cobre os quatro níveis; na tela do N4 ele só tem um valor
                possível, e é a gerência.

                O campo APARECE SEMPRE, e sempre trocável. Sugerido, não
                travado: o gerente abre ação para a gerência ao lado quando o
                problema atravessa a fronteira, e ele é quem sabe quando.
              */}
              <Campo rotulo={nivel === "CROSS" ? "Setor de apoio" : "Gerência"}>
                <select
                  value={bucketId}
                  onChange={(e) => setBucketId(e.target.value)}
                  disabled={agrupamentos.isPending}
                  className="w-full rounded-campo border border-borda bg-superficie px-3 py-[9px] text-corpo disabled:bg-fundo focus:border-borda-hover focus:outline-none"
                >
                  <option value="">
                    {agrupamentos.isPending ? "carregando…" : "— escolha —"}
                  </option>
                  {bucketsDoNivel.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.grupo ? `${b.grupo} · ${b.nome}` : b.nome}
                    </option>
                  ))}
                </select>
                {!agrupamentos.isPending && bucketsDoNivel.length === 0 && (
                  <p className="mt-1 text-micro text-risco-texto">
                    Nenhum agrupamento neste nível — no N4 eles são as gerências
                    (Construção, Não Construção, Operacional).
                  </p>
                )}
                {nomeSugerido && !bucketSugerido && bucketsDoNivel.length > 0 && (
                  <p className="mt-1 text-micro text-texto-ter">
                    Não há agrupamento com o nome de {nomeSugerido} — escolha um.
                  </p>
                )}
              </Campo>
              </>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Prazo">
                <input
                  type="date"
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value)}
                  className="w-full rounded-campo border border-borda bg-superficie px-3 py-[9px] text-corpo focus:border-borda-hover focus:outline-none"
                />
              </Campo>

              <Campo rotulo="Prioridade">
                <div className="flex rounded-controle border border-borda bg-superficie p-[3px]">
                  {opcoes.data.prioridades.map((pr) => (
                    <button
                      key={pr}
                      type="button"
                      onClick={() => setPrioridade(pr)}
                      aria-pressed={prioridade === pr}
                      className={[
                        "flex-1 rounded-botaoPequeno px-3 py-[6px] text-legenda font-bold transition-colors duration-hover",
                        prioridade === pr
                          ? "bg-navy text-white"
                          : "text-texto-sec hover:bg-superficie-hover hover:text-texto",
                      ].join(" ")}
                    >
                      {ROTULO_PRIORIDADE[pr]}
                    </button>
                  ))}
                </div>
              </Campo>
            </div>

            {/*
              O texto de abertura é o CONTEÚDO de GD da ação: o que aconteceu e
              qual é a contramedida. A coluna é obrigatória no banco, e uma ação
              sem ele chega na reunião sem nada para discutir.
            */}
            <Campo rotulo="O que aconteceu, e por que esta é a contramedida">
              <textarea
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder="Faltou produto na ponta em três dias da semana. A contramedida é antecipar a reposição para antes da abertura."
                className="w-full rounded-campo border border-borda bg-superficie px-3 py-[9px] text-corpo focus:border-borda-hover focus:outline-none"
              />
            </Campo>

            {abrir.error && (
              <p className="rounded-controle border border-critico-borda bg-critico-bg px-3 py-2 text-legenda text-critico-texto">
                {mensagemDeErro(abrir.error, "abrir a contramedida")}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-borda pt-4">
              <button
                type="button"
                onClick={onFechar}
                className="rounded-controle border border-borda px-4 py-2.5 text-corpo font-semibold text-texto-sec hover:bg-superficie-hover"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={falta || abrir.isPending}
                className="rounded-controle bg-brand-btn px-5 py-2.5 text-corpo font-bold text-white hover:bg-brand-btnHover disabled:opacity-50"
              >
                {abrir.isPending ? "Abrindo…" : "Abrir ação"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Campo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-eyebrow uppercase text-texto-ter">{rotulo}</span>
      {children}
    </label>
  );
}
