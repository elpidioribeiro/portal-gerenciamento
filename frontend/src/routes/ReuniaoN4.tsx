import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { ALVO_PERFORMANCE } from "../lib/formato.js";
import "./reuniao-n4.css";
import { AbrirAcao } from "../components/acoes/AbrirAcao.js";
import { Faisca } from "../components/Faisca.js";
import { HistoricoMensal } from "../components/HistoricoMensal.js";
import { useSessao } from "../contexts/SessaoContext.js";
import { useAvisoDaTela } from "../contexts/AvisoDaTelaContext.js";
import { useGdsDaTela } from "../contexts/GdsDaTelaContext.js";
import { IconeChevronBaixo } from "../components/ui/Icones.js";
import { MESES, usePeriodo } from "../contexts/PeriodoContext.js";
import { useVisao } from "../contexts/VisaoContext.js";
import { useAlturaDaFaixa } from "../hooks/useAlturaDaFaixa.js";
import {
  alturaDasFaixasFixas,
  apareceAbaixoDasFaixas,
} from "../lib/faixas-fixas.js";
import { mensagemDeErro, variaveisApi } from "../lib/api.js";
import type {
  AreaPerformance,
  AreaVendedor,
  Gerencia,
  ResumoAcao,
} from "../lib/api.js";
import {
  periodoEmCurso,
  semanaAtual,
  useAcoesDaGerencia,
  useCriarPontoCausa,
  useGerencias,
  useGrade,
  useGravarGrade,
  usePareto,
  usePerformanceVendas,
  usePerformanceVendedor,
  useSerieSemanal,
} from "../hooks/useReuniaoN4.js";
import { dinheiro, legendaDaMeta, percentualComSinal } from "../lib/formato.js";
/*
 * `acoes` importado com o nome dele, e NADA nesta tela pode se chamar assim.
 * Sombrear este helper foi como o "6 açãoões" nasceu no N3: com ele invisível, escrever
 * a concordância à mão no JSX era o caminho mais curto. Mesma armadilha de `areas`.
 */
import { areas, coresDaGerencia, nomeLegivel } from "../lib/nomes.js";
import { BlocoDeAcoes } from "../components/acoes/BlocoDeAcoes.js";

/**
 * A tela da reunião do N4 — o gerente adjunto com os supervisores das áreas.
 *
 * **Segue a estrutura do protótipo `docs/demo-n4.html`**, e isso não é
 * preferência: o desenho carrega decisão de processo. Uma primeira versão fez
 * duas tabelas separadas — uma por variável, áreas nas linhas — e virou
 * relatório de números. O protótipo põe as duas variáveis e a marcação DENTRO
 * da linha da área, porque o gesto da reunião é *ver o desvio → apontar a
 * causa* sem sair do lugar.
 *
 * Ver PLANO §7.8, §7.14 e §7.15.
 *
 * A tela é de uma SEMANA. Semana futura não é clicável: marcar ocorrência em
 * semana que não aconteceu enche o Pareto de causa que ninguém viveu.
 */

/** Nulo é "não sei", e nunca vira zero. */
function naMeta(
  percentual: number | null,
  meta: number | null,
): boolean | null {
  /*
   * Sem meta, NÃO RESPONDE -- era `meta ?? 100`, e essa suposição pintava de
   * vermelho tudo que não fosse perfeito. Com Performance Vendas em 95% e
   * nenhum patamar cadastrado, a tela dizia "fora da meta" por uma decisão que
   * ninguém tinha tomado.
   *
   * O comentário de `BlocoVariavel`, três funções abaixo, já dizia isto sobre o
   * rótulo `/85%`: "supor a meta faria a variável parecer no alvo (ou fora
   * dele) por uma decisão que ninguém tomou". A regra valia para o rótulo e não
   * para a conta. Ver §7.37.
   */
  if (percentual === null || meta === null) return null;
  return percentual >= meta;
}

/**
 * O bloco de uma variável no cabeçalho da área: 91% /85%, com a fração abaixo.
 *
 * O `/85%` é a META da variável. Quando ela não está cadastrada o rótulo some,
 * em vez de virar `/100%` — supor a meta faria a variável parecer no alvo (ou
 * fora dele) por uma decisão que ninguém tomou.
 */
function BlocoVariavel({
  rotulo,
  icone,
  percentual,
  meta,
  fracao,
  nota,
  faisca,
  semana,
}: {
  rotulo: string;
  icone: string;
  percentual: number | null;
  meta: number | null;
  /** Aceita NÓ: o valor de vendas leva o farol, e o da meta não. */
  fracao: ReactNode;
  nota?: string | null;
  /** As cinco semanas da área. Ausente = sem série para esta variável. */
  faisca?: Array<number | null>;
  /** Qual ponto ganha o círculo cheio. */
  semana: number;
}) {
  const ok = naMeta(percentual, meta);
  const cor = ok === null ? "n4-vazio" : ok ? "n4-ok" : "n4-ruim";

  return (
    <div className="n4-kpi">
      <div className="n4-kpi-n">
        <span aria-hidden>{icone}</span>
        {rotulo}
      </div>
      <div className="n4-kpi-r">
        <span className={`n4-kpi-v ${cor}`}>
          {percentual === null ? "—" : `${percentual.toFixed(0)}%`}
        </span>
        {meta !== null && <span className="n4-kpi-m">/{meta.toFixed(0)}%</span>}
      </div>
      <div className="n4-kpi-c">{fracao}</div>
      {/*
        A BARRA CONTRA A META, na linha de área.

        Não é volta de nada: a linha de área nunca teve barra -- nem aqui nem no
        protótipo (`docs/demo-n4.html`, função `kpi()`, que é rótulo, número,
        composição e faísca). O que existia era só nos cartões do topo e no
        cartão de gerência do N3.

        Ela entra porque o número sozinho não tem escala: 92% e 104% parecem
        vizinhos escritos e são lados opostos da meta. De longe, numa reunião
        em pé, ninguém lê dois dígitos -- vê a barra.

        DEPOIS da composição, e não antes: é a posição dos cartões do topo, e a
        composição traz os dois valores que a barra resume. Ler os números e
        depois o desenho deles funciona; o contrário obriga a voltar.

        A FAÍSCA continua abaixo, e as duas não competem: a barra diz onde o
        número está HOJE contra a meta, a faísca diz para onde ele vem andando
        nas cinco semanas.
      */}
      <Trilho percentual={percentual} alvo={meta} />
      {nota && <div className="n4-kpi-nota">{nota}</div>}
      {faisca && (
        <Faisca serie={faisca} meta={meta} semana={semana} rotulo={rotulo} />
      )}
    </div>
  );
}

/**
 * A classe de cor do farol, a partir de `naMeta`.
 *
 * `null` é CINZA, e é o caso que a tela mais erra: sem meta cadastrada, ou sem
 * patamar definido, pintar de verde afirmaria "está bom" sobre o que ninguém
 * comparou -- a afirmação mais forte da tela feita sobre o que não se mediu.
 * Ver §7.37.
 */
function corDoFarol(ok: boolean | null): string {
  return ok === null ? "n4-vazio" : ok ? "n4-ok" : "n4-ruim";
}

/**
 * A TARJA ESQUERDA da linha: verde na meta, vermelha fora, cinza sem meta.
 *
 * Antes só existia FORA da meta -- `.n4-linha.alerta` pintava 4px de vermelho,
 * e a linha em dia não tinha tarja nenhuma. Funcionava como alarme e não como
 * farol: ausencia de tarja significava "está bom" OU "sem meta cadastrada", que
 * são coisas diferentes e apareciam iguais.
 *
 * Cores de PONTO e não de texto: é faixa de 4px vista de longe. `--off` sem
 * meta, porque sem com o que comparar não há farol (§7.37).
 *
 * Par do `tarjaDoFarol` do N3 -- a mesma regra nas duas telas.
 */
function tarjaDoFarol(ok: boolean | null): string {
  if (ok === null) return "var(--off)";
  return ok ? "var(--ok-ponto)" : "var(--cri-ponto)";
}

/**
 * O RESUMO DA GERÊNCIA — o número pelo qual o N4 responde no N3.
 *
 * Três cartões numa caixa só, e a ordem é a da conversa: quanto FALTA, e depois
 * como estão as duas variáveis. O primeiro é o único da tela que responde em
 * reais, de propósito — ele é a pergunta da reunião ("quanto falta para bater a
 * semana?"), os outros dois são como se está indo.
 *
 * É o mesmo padrão do cabeçalho do N3, e isso é o ponto: o N4 apresenta este
 * bloco na reunião do N3, onde ele aparece de novo somado às outras gerências.
 * Duas formas diferentes para o mesmo número obrigariam a reaprender a leitura
 * no meio da cadeia de ajuda.
 *
 * O rolo SOMA numerador e denominador; não é a média dos percentuais das áreas.
 * Uma área de 4 vendedores não pode pesar igual a uma de 18.
 */
function ResumoDaGerencia({
  vendas,
  vendedor,
  serieVendas,
  serieVendedor,
  areasFora,
  areasComMeta,
  metaVendas,
  semana,
  emCurso,
  historico,
  onHistorico,
}: {
  vendas: {
    percentual: number | null;
    numerador: number;
    denominador: number;
  } | null;
  vendedor: {
    percentual: number | null;
    numerador: number;
    denominador: number;
  } | null;
  serieVendas: Array<number | null> | null;
  serieVendedor: Array<number | null> | null;
  areasFora: number;
  areasComMeta: number;
  metaVendas: number | null;
  semana: number;
  /** O período escolhido ainda está correndo. Ver `periodoEmCurso`. */
  emCurso: boolean;
  /**
   * QUAL histórico está aberto, ou nenhum.
   *
   * Um por indicador, e não um botão só para os dois: cada cartão leva ao
   * gráfico DELE. Vendas na meta abre Performance Vendas; Vendedores na meta
   * abre Performance Vendedor. São perguntas separadas — a segunda não tem nem
   * patamar de meta (§7.37) —, e abrir os dois obrigaria a procurar qual dos
   * dois gráficos responde o número que se acabou de olhar.
   *
   * O estado é de FORA porque o que ele mostra fica fora deste cartão: a seção
   * "Como viemos até aqui", depois das áreas. Aqui ficam os gatilhos.
   */
  historico: "vendas" | "vendedor" | null;
  onHistorico: (qual: "vendas" | "vendedor") => void;
}) {
  /*
   * O que falta é a diferença em REAIS, e não `100% - percentual`: é o número
   * que a reunião consegue perseguir. Nunca negativo -- passar da meta é bom, e
   * "faltam -400 mil" não é português.
   */
  /*
   * A diferença COM SINAL: negativa quando a projeção passa da meta.
   *
   * Era `Math.max(0, ...)`, e o zero ia para o maior número da tela -- "R$ 0
   * mil" para dizer que não falta nada. O slot mais visível do quadro gasto
   * para anunciar uma ausência, e escrito como se fosse dinheiro.
   *
   * Zero não é notícia; superar é. Com o sinal, o cartão mostra o quanto FALTA
   * ou o quanto PASSOU, e o número grande sempre significa alguma coisa.
   */
  const diferenca =
    vendas && vendas.denominador > 0
      ? vendas.denominador - vendas.numerador
      : null;
  const alcancada = diferenca !== null && diferenca <= 0;
  /* O MESMO percentual do N3, e com o sinal SOBRE A META -- ver o comentário lá. */
  const pctSobreAMeta =
    vendas && vendas.denominador > 0
      ? ((vendas.numerador - vendas.denominador) / vendas.denominador) * 100
      : null;

  return (
    <section className="n4-topo">
      {/*
        VENDAS NA META vem primeiro, e a PROJEÇÃO depois.

        A reunião abre pelo indicador -- "estamos em 108%" é a pergunta do
        quadro --, e a projeção em reais é a consequência dele: quanto isso vira
        no fechamento do mês. Começava pela projeção, que é o número mais
        chamativo e o mais derivado.

        Os dois chips de área foram para o cartão de Vendas: eles desdobram o
        INDICADOR, não a projeção em reais.
      */}
      {vendas && (
        <div className="n4-topo-card">
          <span className="n4-topo-linha">
            <span className="n4-topo-rot">Vendas na meta</span>
            <DeltaSemanal serie={serieVendas} semana={semana} />
          </span>
          {/*
            UMA FAIXA POR LINHA: rótulo, número, texto, barra.

            Estavam todos numa `.n4-topo-linha` (`space-between`, com wrap).
            Quando o texto não cabia ao lado do número -- e "VENDAS x | META y"
            nunca cabe -- ele quebrava para baixo e empurrava a barra: medido no
            N3, a barra de um cartão em y=141 e a do vizinho em y=89. Lado a
            lado, 52px de desalinho que variava com a largura da tela.

            Com uma faixa por linha os cartões têm o MESMO ritmo vertical em
            qualquer largura, porque nenhuma faixa depende de caber ao lado de
            outra. A régua segue colada ao número, no `.n4-topo-par`.
          */}
          <span className="n4-topo-par">
            <span
              className={`n4-topo-v ${corDoFarol(naMeta(vendas.percentual, metaVendas))}`}
            >
              {vendas.percentual === null
                ? "—"
                : `${Math.round(vendas.percentual)}%`}
            </span>
            {/*
                A referência da meta: as linhas de área abaixo mostram
                "112% / 100%" e este cartão mostrava "108%" sozinho -- percentual
                sem dizer contra o quê. Sai de `metaVendas`, o mesmo valor que
                colore o número: uma régua só.
              */}
            {metaVendas !== null && (
              <span className="n4-topo-m">/ {Math.round(metaVendas)}%</span>
            )}
          </span>
          <span className="n4-topo-c">
            {vendas.denominador > 0 ? (
              <>
                <span className="n4-comp-rot">Vendas</span>{" "}
                <span
                  className={corDoFarol(naMeta(vendas.percentual, metaVendas))}
                >
                  {dinheiro(vendas.numerador)}
                </span>
                <span className="n4-comp-sep" aria-hidden />
                <span className="n4-comp-rot">Meta</span>{" "}
                {dinheiro(vendas.denominador)}
              </>
            ) : (
              "sem meta na competência"
            )}
          </span>
          <Trilho percentual={vendas.percentual} alvo={metaVendas} />
          {/*
            A FAÍSCA da gerência -- as cinco semanas.

            Ela e o `DeltaSemanal` ao lado do rótulo não se repetem: o delta é o
            ÚLTIMO movimento e a faísca é a forma do caminho. Os dois saem da
            MESMA `serieVendas`, então não têm como discordar.

            Depois da barra e antes dos chips: número, régua e tendência são o
            mesmo assunto; os chips são o desdobramento por área.

            `serieVendas` pode vir `null` (a série ainda não chegou), e a
            `Faisca` não aceita nulo -- some, em vez de desenhar uma linha reta
            que passaria por cinco semanas sem apuração.
          */}
          {serieVendas && (
            <Faisca
              serie={serieVendas}
              meta={metaVendas}
              semana={semana}
              rotulo="Vendas na meta"
            />
          )}
          {/*
            OS DOIS CHIPS ficam com VENDAS NA META, e não com a projeção.

            "6 de 12 áreas fora da meta" é o desdobramento DESTE indicador: diz
            de onde vem o percentual acima. Estavam no cartão de projeção por
            terem nascido junto dele, e ali respondiam uma pergunta que aquele
            cartão não faz -- o dele é quanto falta em reais.
          */}
          {areasComMeta > 0 && (
            <div className="n4-topo-chips">
              <span className="n4-chip-mini ruim">
                {areasFora} de {areas(areasComMeta)} fora da meta
              </span>
              <span className="n4-chip-mini ok">
                {areas(areasComMeta - areasFora)} na meta
              </span>
            </div>
          )}
          <VerHistorico
            aberto={historico === "vendas"}
            onClick={() => onHistorico("vendas")}
          />
        </div>
      )}
      {/*
        O GAP NO MEIO -- Vendas, Gap, Vendedores (10/09/2026).

        Ordem dada pelo analista, e a leitura fecha melhor: "estamos em 95% da
        meta" (o indicador), "isso da' R$ 759 mil de gap" (a consequencia em
        reais), "e 31 de 52 vendedores sustentaram" (de onde vem). O gap era o
        ultimo, e ficava separado do numero que ele traduz.

        A ordem ja' foi Projecao-Vendas-Vendedores, Vendas-Vendedores-Projecao,
        e agora Vendas-Gap-Vendedores. O que mudou em cada volta foi a pergunta
        que a reuniao faz primeiro; o registro fica para a proxima nao comecar
        do zero.
      */}
      <div className="n4-topo-card destaque">
        {/*
         * "Projeção × meta", e não "Consolidado".
         *
         * O número é `meta − projeção de fechamento`, com sinal: o quanto
         * FALTA ou o quanto PASSOU. "Consolidado" não dizia nada sobre isso --
         * nomeava o cartão pelo fato de ser o rolo da gerência, que é a única
         * coisa que a tela já repete no cabeçalho e no seletor.
         *
         * "Falta para a meta" seria mais direto de ler e mentiria metade do
         * tempo: quando a projeção passa da meta, o cartão mostra sobra.
         */}
        {/*
          O ROTULO DIZ O QUE O NUMERO E' -- e ele NAO e' a projecao.

          Dizia "Projecao de vendas", e o numero embaixo e' `meta - projecao`:
          a DIFERENCA. Palavra do analista (10/09/2026): *"parece que o valor
          exposto e' o valor da projecao, mas e' a diferenca entre a meta e a
          projecao"*. Um rotulo que nomeia uma grandeza sobre um numero que e'
          outra e' pior do que um rotulo vago -- quem le' de longe le' o titulo
          e acredita nele.

          O ROTULO ACOMPANHA O SINAL, porque a mesma conta responde duas
          perguntas: falta, ou passou. Um texto fixo mentiria metade do tempo,
          e foi por isso que "Falta para a meta" tinha sido recusado antes --
          a saida nao era voltar a um nome vago, era deixar o rotulo virar com
          o sinal.

          A LEGENDA de baixo ficou com o percentual e sem o verbo: com
          "falta" nos dois lugares, o cartao diria a mesma palavra duas vezes
          em tres linhas.
        */}
        <span className="n4-topo-rot">Gap (Projeção vs Meta)</span>
        {diferenca === null ? (
          <>
            <span className="n4-topo-v">—</span>
            <span className="n4-topo-c">sem meta de venda cadastrada</span>
          </>
        ) : (
          <>
            {/*
              O FAROL NO NÚMERO, e não só no trilho abaixo.

              Verde quando a projeção alcança a meta, vermelho quando falta. É
              o maior número da tela e era o único sem cor -- quem lê de longe
              via o valor antes de ver a barra.
            */}
            <span className={`n4-topo-v ${alcancada ? "n4-ok" : "n4-ruim"}`}>
              {alcancada ? `+${dinheiro(-diferenca)}` : dinheiro(diferenca)}
            </span>
            {/* A LEGENDA acompanha o farol do número: as duas dizem a mesma
                coisa, e uma cinza ao lado de um número verde faria o olho
                procurar a diferença entre elas. */}
            <span className={`n4-topo-c ${alcancada ? "n4-ok" : "n4-ruim"}`}>
              {legendaDaMeta(alcancada, emCurso)}
            </span>
            {/*
              A TERCEIRA linha é uma FAIXA, e não mais texto corrido.

              Forma dada pelo analista: rótulo à esquerda em caiça alta, valor
              à direita, separados por um filete. Ela responde outra pergunta
              que as duas de cima -- o tamanho RELATIVO --, e como texto
              corrido logo abaixo de "acima da meta" as três viravam um
              parágrafo de três linhas.

              Só aparece com percentual: sem meta não há divisão, e uma faixa
              com o rótulo e um traço do lado seria moldura vazia.
            */}
            {pctSobreAMeta !== null && (
              <span className="n4-topo-proj">
                <span className="n4-topo-rot">Projeção de fechamento</span>
                <span
                  className={`n4-topo-proj-v ${alcancada ? "n4-ok" : "n4-ruim"}`}
                >
                  {percentualComSinal(pctSobreAMeta)}
                </span>
              </span>
            )}
          </>
        )}
      </div>
      {vendedor && (
        <div className="n4-topo-card">
          <span className="n4-topo-linha">
            <span className="n4-topo-rot">Vendedores na meta</span>
            <DeltaSemanal serie={serieVendedor} semana={semana} />
          </span>
          {/* As mesmas quatro faixas do cartão ao lado -- é o que os alinha. */}
          <span className="n4-topo-par">
            {/*
              NEUTRO sempre: Performance Vendedor não tem patamar (§7.37), e sem
              alvo não há o que pintar. O trilho abaixo já é cinza pela mesma
              razão; aqui é a mesma regra, no número.
            */}
            <span className={`n4-topo-v ${corDoFarol(null)}`}>
              {vendedor.percentual === null
                ? "—"
                : `${Math.round(vendedor.percentual)}%`}
            </span>
          </span>
          <span className="n4-topo-c">
            {vendedor.denominador > 0
              ? `${vendedor.numerador} de ${vendedor.denominador} vendedores`
              : "ninguém na conta"}
          </span>
          {/* Sem alvo: Vendedor não tem patamar de propósito (§7.37). */}
          <Trilho percentual={vendedor.percentual} alvo={null} />
          {/* `meta={null}`: sem patamar não há régua tracejada (§7.37). */}
          {serieVendedor && (
            <Faisca
              serie={serieVendedor}
              meta={null}
              semana={semana}
              rotulo="Vendedores na meta"
            />
          )}
          <VerHistorico
            aberto={historico === "vendedor"}
            onClick={() => onHistorico("vendedor")}
          />
        </div>
      )}
    </section>
  );
}

/**
 * "Ver histórico" — o gatilho DENTRO do cartão do indicador.
 *
 * Os doze meses saíram de sempre-visíveis para atrás deste link (09/09/2026):
 * eram dois gráficos de doze barras no caminho de todos os dias, entre as áreas
 * e o bloco de causas, para uma pergunta que se faz quando o número
 * surpreende — não a cada abertura.
 *
 * Um por cartão, e cada um leva ao SEU gráfico. A tela rola até lá (ver o
 * `useEffect` em `ReuniaoN4`): um link que revela algo três telas abaixo sem
 * levar ninguém até lá se lê como link que não funcionou.
 *
 * `margin-top: auto` no CSS prende o link ao rodapé do cartão, então os dois
 * caem na mesma altura mesmo com os cartões tendo conteúdos de tamanhos
 * diferentes -- Vendas tem os dois chips de área embaixo, Vendedor não.
 */
function VerHistorico({
  aberto,
  onClick,
}: {
  aberto: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="n4-hist-link"
      aria-expanded={aberto}
      onClick={onClick}
    >
      <span className="n4-pontos-chevron" aria-hidden>
        {aberto ? "▾" : "▸"}
      </span>
      {aberto ? "Ocultar histórico" : "Ver histórico"}
    </button>
  );
}

/**
 * A barra contra o alvo.
 *
 * O número sozinho não tem escala: 92% e 104% parecem vizinhos escritos, e são
 * lados opostos da meta.
 *
 * Sem alvo a barra é CINZA, e não verde -- é a mesma regra do resto do portal:
 * pintar de verde o que ninguém comparou é a afirmação mais forte da tela feita
 * sobre o que não se mediu.
 */
function Trilho({
  percentual,
  alvo,
}: {
  percentual: number | null;
  alvo: number | null;
}) {
  if (percentual === null) return <span className="n4-trilho" aria-hidden />;
  const cheio = Math.max(
    0,
    Math.min(100, alvo && alvo > 0 ? (percentual / alvo) * 100 : percentual),
  );
  /*
   * DUAS FAIXAS, porque estas telas são do GD de VENDAS.
   *
   * Havia uma terceira, âmbar, para "quase lá" (>= 95% da meta), com o
   * argumento de que quase lá não é a mesma coisa que longe. O argumento é bom
   * e a faixa não é de Vendas.
   *
   * Quem manda nisso é o servidor, em `FAIXA_POR_INDICADOR`
   * (`indicadores/status.ts`): ele tem regra de três ou quatro faixas para
   * **nps** e **perdas**, e para todo o resto -- Vendas inclusa -- cai em
   * `situacaoDoDesvio`, que é binária. A legenda da matriz do N2 diz a mesma
   * coisa em português: "no limite ou pouco abaixo (NPS e Perdas)".
   *
   * O custo de manter era pior que perder o âmbar: o NÚMERO ao lado usa
   * `naMeta`, que é binária, então uma área a 97% aparecia com o número
   * VERMELHO e a barra ÂMBAR no mesmo bloco. Dois faróis discordando sobre o
   * mesmo valor -- e ninguém lê um quadro reparando em qual dos dois é mais
   * granular.
   *
   * QUANDO uma destas telas mostrar NPS ou Perdas, a faixa não volta escrita
   * aqui: vem do servidor junto do ponto, como já acontece na matriz do N2.
   * Reinventar o limiar no cliente foi exatamente o que produziu esta
   * discordância.
   */
  const faixa = alvo === null ? "sem" : percentual >= alvo ? "ok" : "ruim";
  return (
    <span className="n4-trilho" aria-hidden>
      <span
        className={`n4-trilho-cheio ${faixa}`}
        style={{ width: `${cheio}%` }}
      />
    </span>
  );
}

/**
 * O movimento contra a semana anterior, em pontos percentuais.
 *
 * É o que transforma um número num movimento: 97% parado e 97% subindo pedem
 * conversas diferentes.
 *
 * `p.p.` e não `%`: subir de 92% para 95% são três PONTOS percentuais, não 3%.
 * A diferença importa porque o número ao lado já é um percentual, e somar
 * percentual de percentual é o erro clássico deste tipo de painel.
 */
function DeltaSemanal({
  serie,
  semana,
}: {
  serie: Array<number | null> | null;
  semana: number;
}) {
  if (!serie) return null;
  const agora = serie[semana - 1];
  const antes = serie[semana - 2];
  // Semana 1 não tem anterior, e semana sem apuração não vira zero.
  if (agora == null || antes == null) return null;
  const valor = agora - antes;
  return (
    <span
      className={`n4-delta ${valor > 0 ? "sobe" : valor < 0 ? "desce" : ""}`}
    >
      {valor > 0 ? "+" : ""}
      {valor.toFixed(1).replace(".", ",")} p.p. vs S{semana - 1}
    </span>
  );
}

function Selo({ ok }: { ok: boolean | null }) {
  /*
   * O invólucro de largura fixa é o que mantém a coluna alinhada de área para
   * área: "Na meta" e "Fora da meta" têm larguras diferentes, e sem ele cada
   * selo parava num lugar.
   */
  return (
    <span className="n4-selo">
      {ok === null ? (
        <span
          className="n4-chip sem"
          title="Falta dado para responder — não é o mesmo que estar fora da meta"
        >
          sem resposta
        </span>
      ) : ok ? (
        <span className="n4-chip ok">
          <span
            className="n4-ponto"
            style={{ background: "var(--ok-ponto)" }}
          />
          Na meta
        </span>
      ) : (
        <span className="n4-chip ruim">
          <span
            className="n4-ponto"
            style={{ background: "var(--cri-ponto)" }}
          />
          Fora da meta
        </span>
      )}
    </span>
  );
}

/**
 * A grade de marcação: pontos de causa × semanas, com contador.
 *
 * **Dois modos, uma peça.** Com `areaVendaId` é a grade DAQUELA área — a que se
 * preenche, dentro do cartão dela. Sem ele é a SOMA da gerência, e o servidor
 * devolve `podeMarcar: false`: não existe onde gravar uma soma. Ver PLANO
 * §7.59.
 *
 * Duplicar o componente para o modo de leitura pareceu tentador e é o caminho
 * de sempre para as duas telas divergirem — uma ganha coluna, a outra não, e o
 * total de uma deixa de bater com o da outra sem ninguém mexer nas duas.
 *
 * **Conta em memória e grava no CONFIRMAR.** Era uma requisição por clique, e
 * o banco responde em ~120 ms por ida: marcar cinco células levava a conversa
 * da reunião junto. Agora o número muda na hora e o botão manda tudo de uma
 * vez. Ver PLANO §7.21.
 *
 * A coluna da semana escolhida é a única editável — as outras aparecem para
 * dar o ciclo, não para reescrever o passado numa reunião de hoje.
 */
function Grade({
  variavelId,
  variavel,
  gerenciaId,
  areaVendaId,
  ano,
  mes,
  semana,
  enquadre = "cartao",
}: {
  variavelId: string;
  /**
   * O NOME da variável, para o botão dizer de quê são estes pontos de causa.
   *
   * `null` no somátorio: lá o nome já está no seletor ao lado, no cabeçalho da
   * própria seção -- di-lo duas vezes em 4cm.
   */
  variavel: string | null;
  /** Qual soma. Continua vindo mesmo com a área: é contra ele que ela é conferida. */
  gerenciaId: string;
  /** Onde se conta. Ausente = a soma da gerência, só de leitura. */
  areaVendaId?: string;
  ano: number;
  mes: number;
  semana: number;
  /**
   * `nu` tira o `.n4-cartao` de fora: dentro do cartão da área já existe uma
   * moldura, e duas caixas coladas viram duas bordas e dois fundos.
   */
  enquadre?: "cartao" | "nu";
}) {
  /**
   * FECHADA por padrão dentro da área; aberta no somatório.
   *
   * Treze áreas com a grade aberta são treze tabelas de pontos de causa numa
   * tela, e a linha do indicador -- que é o que se lê primeiro -- some no meio
   * delas. O somatório é um só e não tem o que esconder.
   */
  const [aberta, setAberta] = useState(enquadre === "cartao");

  const grade = useGrade(
    variavelId,
    {
      ano,
      mes,
      gerenciaId,
      ...(areaVendaId === undefined ? {} : { areaVendaId }),
    },
    aberta,
  );
  const gravar = useGravarGrade(variavelId);
  /*
   * O nome do ponto novo, e o `null` é informação: fechado. String vazia é
   * formulário aberto e ainda em branco -- dois estados diferentes, e com um
   * booleano à parte eles sairiam de sincronia na primeira desistência.
   */
  const [novo, setNovo] = useState<string | null>(null);
  const criarPonto = useCriarPontoCausa(variavelId);

  /**
   * O que mudou desde a última leitura: `pontoCausaId` → quantidade.
   *
   * Só o que foi TOCADO, e não a grade inteira, porque é isso que vai no corpo
   * — mandar tudo reescreveria o `registradoEm` de células que ninguém mexeu.
   */
  const [rascunho, setRascunho] = useState<Record<string, number>>({});

  /*
   * Trocar de semana, de mês, de gerência ou de ÁREA começa uma grade nova. Sem
   * isto, o rascunho de uma semana seria gravado na outra — o número certo na
   * célula errada, que é pior do que um erro visível.
   */
  const contexto = `${gerenciaId}|${areaVendaId ?? "-"}|${String(ano)}|${String(mes)}|${String(semana)}`;
  const [contextoAtual, setContextoAtual] = useState(contexto);
  if (contextoAtual !== contexto) {
    setContextoAtual(contexto);
    setRascunho({});
  }

  /*
   * `dados` em vez de sair fora: o botão de expandir tem de existir ANTES da
   * resposta, senão ele só apareceria depois da consulta que ele mesmo dispara
   * -- e nada dispararia consulta nenhuma.
   */
  const dados = grade.data ?? null;

  const podeMarcar = dados?.podeMarcar ?? false;
  const salvo = (pontoId: string) =>
    dados?.pontosCausa.find((p) => p.id === pontoId)?.semanas[semana - 1] ?? 0;
  const valor = (pontoId: string) => rascunho[pontoId] ?? salvo(pontoId);

  function mexer(pontoId: string, delta: 1 | -1) {
    setRascunho((r) => {
      const novo = Math.max(0, (r[pontoId] ?? salvo(pontoId)) + delta);
      /*
       * Voltar ao valor gravado TIRA a célula do rascunho. Mandá-la assim
       * mesmo gravaria o mesmo número com carimbo novo, e o histórico diria
       * que alguém marcou quando ninguém marcou.
       */
      if (novo === salvo(pontoId)) {
        const { [pontoId]: _fora, ...resto } = r;
        return resto;
      }
      return { ...r, [pontoId]: novo };
    });
  }

  const pendentes = Object.entries(rascunho);
  const temPendencia = pendentes.length > 0;

  const nu = enquadre === "nu";

  return (
    <div className={nu ? "n4-grade-nua" : "n4-cartao"}>
      {nu ? (
        /*
          SEM título, e sem instrução: dentro da área o botão já diz o que tem
          dentro, e o "Conte as ocorrências da semana N" repetia por área o que
          a tela diz uma vez no cabeçalho da semana. Com três áreas abertas era
          a mesma frase três vezes na mesma rolagem.
        */
        <button
          type="button"
          className={`n4-pontos-abrir ${aberta ? "aberta" : ""}`}
          aria-expanded={aberta}
          /*
            A dica do mouse ACOMPANHA O ESTADO: "Expandir" sobre uma grade já
            aberta seria a tela prometendo o contrário do que o clique faz.
            Mesma regra dos outros dois botões desta tela -- o rótulo nomeia o
            destino do clique, não a situação atual.
          */
          title={
            aberta ? "Recolher pontos de causa" : "Expandir pontos de causa"
          }
          onClick={() => setAberta((v) => !v)}
        >
          {/*
            O CHEVRON APONTA PARA ONDE O CONTEÚDO APARECE — para baixo.

            Era `▸` fechado e `▾` aberto: o triângulo de árvore de arquivos.
            Ele é familiar para quem programa e ambíguo para quem está na
            reunião -- aponta para o LADO, e na tela nada acontece do lado. O
            analista: *"deixe claro como um drill down, essa seta pro lado não
            tá muito intuitivo"*.

            Baixo fechado, e gira 180° ao abrir. A seta passa a descrever o
            movimento real: o detalhe desce abaixo do cartão.

            E vira o ícone do projeto em vez de um caractere de texto: o glifo
            `▸` depende da fonte instalada e muda de tamanho e de alinhamento
            entre sistemas -- a mesma razão pela qual o resto da tela usa SVG.
          */}
          <span className="n4-pontos-chevron" aria-hidden>
            <IconeChevronBaixo tamanho={13} />
          </span>
          {/*
            O RÓTULO GANHOU VERBO. "Pontos de causa" sozinho é um substantivo:
            lê-se como TÍTULO da seção, e título não promete clique. "Ver" diz
            o que o botão faz, e "Ocultar" diz o que ele fará da próxima vez --
            a mesma regra do `title` logo acima.
          */}
          {aberta ? "Ocultar pontos de causa" : "Ver pontos de causa"}
          {/*
            O NOME DA VARIÁVEL NO BOTÃO -- o rótulo que viaja (10/09/2026).

            O seletor está no cabeçalho da lista, logo acima -- perto, mas fora
            do cartão. Numa reunião com três áreas abertas, quem rola até a
            terceira grade já não vê qual lente está ligada, e a queixa do
            analista era exatamente essa: não saber que o controle governava
            estas grades.

            Um rótulo não compete com nada e responde a pergunta no ponto em que
            ela aparece: "estes pontos de causa são de quê?". Ver o comentário
            do seletor, no cabeçalho de "O que aconteceu".
          */}
          {variavel !== null && (
            <span className="n4-pontos-var">{variavel}</span>
          )}
          {/*
            A pendência aparece FECHADA também. Sem isto, fechar a grade com
            contagem não gravada esconderia o aviso junto com a grade -- e o
            trabalho da reunião sairia da tela sem nunca ter sido gravado.
          */}
          {temPendencia && !aberta && (
            <span className="n4-pontos-pend">
              {pendentes.length} {pendentes.length === 1 ? "linha" : "linhas"}{" "}
              não gravada
              {pendentes.length === 1 ? "" : "s"}
            </span>
          )}
        </button>
      ) : (
        <div className="n4-titulo-bloco">
          {/*
            Sem título próprio: a seção que envolve a grade já se chama "Por que
            aconteceu". Repetir dava o mesmo texto duas vezes, uma embaixo da
            outra.
          */}
          <h3>Somatório da gerência</h3>
          <p>
            A soma das áreas — é aqui que a reunião olha. Conta-se dentro de
            cada área, acima
          </p>
        </div>
      )}

      {aberta && dados === null && (
        <p style={{ padding: 16, color: "var(--ter)" }}>Carregando…</p>
      )}

      {/*
        A grade ROLA na horizontal quando não cabe, em vez de encolher.

        A regra `.n4-grade-rolagem` existia no CSS desde a primeira passada de
        responsividade e nunca tinha sido ligada aqui -- num painel de 393px a
        tabela media 394px dentro de um container de 329px e empurrava a PÁGINA
        inteira para o lado. Espremer as colunas não era opção: o que encolhe
        primeiro é o nome do ponto de causa, que é a frase que a reunião
        discute.
      */}
      {aberta && dados !== null && (
        <div className="n4-grade-rolagem">
          <table className="n4-grade">
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingLeft: 18 }}>
                  Ponto de causa
                </th>
                {[1, 2, 3, 4, 5].map((s) => (
                  <th key={s} className={s === semana ? "col-on" : ""}>
                    S{s}
                  </th>
                ))}
                <th>Ciclo</th>
              </tr>
            </thead>
            <tbody>
              {dados.pontosCausa.map((p) => {
                /*
                 * O total do ciclo acompanha o rascunho. Deixá-lo no valor gravado
                 * mostraria a soma discordando das células logo ao lado, e quem
                 * olha não teria como saber qual das duas é a verdade.
                 */
                const mexida = rascunho[p.id];
                const total =
                  mexida === undefined
                    ? p.total
                    : p.total - p.semanas[semana - 1]! + mexida;

                return (
                  <tr key={p.id}>
                    <td className="esq">{p.nome}</td>
                    {p.semanas.map((n, i) => {
                      const daSemana = i + 1 === semana;
                      const atual = daSemana ? valor(p.id) : n;
                      return (
                        <td key={i} className={daSemana ? "col-on" : ""}>
                          {daSemana && podeMarcar ? (
                            <span className="inline-flex items-center gap-1">
                              {atual > 0 && (
                                <button
                                  className="n4-menos"
                                  title="Tirar uma ocorrência"
                                  onClick={() => mexer(p.id, -1)}
                                >
                                  −
                                </button>
                              )}
                              <button
                                className={`n4-celula ${atual > 0 ? "" : "vazia"}`}
                                onClick={() => mexer(p.id, 1)}
                              >
                                {atual > 0 ? atual : "+"}
                              </button>
                            </span>
                          ) : (
                            <span className="n4-celula fechada">
                              {atual > 0 ? atual : "·"}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="n4-ciclo">{total > 0 ? total : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/*
        ADICIONAR PONTO DE CAUSA — a causa nova tem nome na reunião.

        Só onde se MARCA (`podeMarcar`, dentro da área): a soma da gerência é de
        leitura, e um botão de criar ali prometeria uma linha que ninguém conta.

        O aviso do alcance não é decoração. O ponto é cadastro da VARIÁVEL: ele
        nasce em todas as áreas e nas outras filiais que a acompanham. Sem a
        frase, quem cria acha que está mexendo na própria grade -- e é o que
        mantém o Pareto comparável entre gerências.
      */}
      {aberta && podeMarcar && (
        <div className="n4-novo-ponto">
          {novo === null ? (
            <button
              type="button"
              className="n4-novo-ponto-abrir"
              onClick={() => {
                setNovo("");
                criarPonto.reset();
              }}
            >
              <span aria-hidden>+</span> Ponto de causa
            </button>
          ) : (
            <form
              className="n4-novo-ponto-forma"
              onSubmit={(e) => {
                e.preventDefault();
                const nome = novo.trim();
                if (nome.length < 3) return;
                criarPonto.mutate(nome, { onSuccess: () => setNovo(null) });
              }}
            >
              <input
                className="n4-novo-ponto-campo"
                value={novo}
                autoFocus
                maxLength={120}
                placeholder="O que causou o desvio?"
                onChange={(e) => setNovo(e.target.value)}
                /* Esc fecha: numa reunião, tirar a mão do teclado para achar
                   "Cancelar" com o mouse custa mais que o próprio nome. */
                onKeyDown={(e) => {
                  if (e.key === "Escape") setNovo(null);
                }}
              />
              <button
                type="submit"
                /* `.n4-btn-ok` e `.n4-btn-desfazer` são o par que a barra de
                   confirmação já usa: mesma decisão, mesmo desenho. */
                className="n4-btn-ok"
                /* 3 é o mínimo do servidor. Botão que aceita e volta com erro
                   ensina a desconfiar do formulário. */
                disabled={novo.trim().length < 3 || criarPonto.isPending}
              >
                {criarPonto.isPending ? "Adicionando…" : "Adicionar"}
              </button>
              <button
                type="button"
                className="n4-btn-desfazer"
                onClick={() => setNovo(null)}
              >
                Cancelar
              </button>
            </form>
          )}
          {novo !== null && (
            <p className="n4-novo-ponto-nota">
              Vale para todas as áreas
              {variavel === null ? "" : ` de ${variavel}`} — o ponto de causa é
              da variável de controle, não desta área.
            </p>
          )}
          {criarPonto.isError && (
            <p className="n4-novo-ponto-erro">
              {mensagemDeErro(criarPonto.error, "adicionar o ponto de causa")}
            </p>
          )}
        </div>
      )}

      {/*
        A barra de confirmação só existe quando há o que confirmar. Um botão
        permanente e sempre desabilitado ensina a ignorá-lo, e é justamente
        este que não pode ser ignorado: sem ele nada é gravado.
      */}
      {/*
        `aberta &&`: a resposta fica em cache mesmo com a consulta desligada, e
        sem isto a barra de confirmação continuaria embaixo do botão fechado --
        um "Confirmar" solto, sem a grade que ele confirma.
      */}
      {aberta && podeMarcar && temPendencia && (
        <div className="n4-confirmar">
          <span>
            {pendentes.length}{" "}
            {pendentes.length === 1 ? "linha alterada" : "linhas alteradas"} —
            ainda não gravado
          </span>
          <button
            type="button"
            className="n4-btn-desfazer"
            onClick={() => setRascunho({})}
            disabled={gravar.isPending}
          >
            Desfazer
          </button>
          <button
            type="button"
            className="n4-btn-ok"
            disabled={gravar.isPending}
            onClick={() =>
              gravar.mutate(
                {
                  gerenciaId,
                  /*
                   * `areaVendaId!`: o botão só existe quando `podeMarcar`, e o
                   * servidor devolve `podeMarcar: false` sem área. É a mesma
                   * afirmação nas duas pontas, e a de lá é a que vale.
                   */
                  areaVendaId: areaVendaId!,
                  ano,
                  mes,
                  celulas: pendentes.map(([pontoCausaId, quantidade]) => ({
                    pontoCausaId,
                    semana,
                    quantidade,
                  })),
                },
                // O rascunho só é descartado depois de gravado. Limpar antes
                // apagaria o trabalho da reunião se a gravação falhasse.
                { onSuccess: () => setRascunho({}) },
              )
            }
          >
            {gravar.isPending ? "Gravando…" : "Confirmar"}
          </button>
        </div>
      )}

      {gravar.error && (
        <p className="n4-erro">
          {mensagemDeErro(gravar.error, "gravar as marcações")}
        </p>
      )}
    </div>
  );
}

/**
 * O Pareto — onde atacar primeiro.
 *
 * A nota de rodapé não é enfeite: sem ela o gráfico é lido como diagnóstico. O
 * Pareto **prioriza**, não explica; a causa raiz sai da discussão em frente ao
 * quadro. Está no protótipo pelo mesmo motivo.
 */
function Pareto({
  variavelId,
  gerenciaId,
  gerenciaNome,
  ano,
  mes,
  filial,
  contexto,
}: {
  variavelId: string;
  gerenciaId: string;
  /** Vira o agrupamento da ação — o quadro do N4 é o da gerência. §7.28. */
  gerenciaNome: string;
  ano: number;
  mes: number;
  /** Sigla da loja, para a ação nascer nela. */
  filial: string;
  /** "Performance Vendas · CONSTRUÇÃO" — vira a `origem` registrada na ação. */
  contexto: string;
}) {
  const pareto = usePareto(variavelId, { ano, mes, gerenciaId });
  /**
   * A causa escolhida para abrir ação. Nula = o formulário está fechado.
   *
   * O botão fica em CADA linha, e não um só no rodapé: a ação é sobre UMA
   * causa, e um botão solto obrigaria a escolher de novo o que a barra já
   * dizia. Ver PLANO §7.11 -- é o elo que fecha o ciclo do GD.
   */
  const [causa, setCausa] = useState<{ id: string; nome: string } | null>(null);
  if (pareto.isLoading || !pareto.data) return null;

  const { total, itens } = pareto.data;
  if (total === 0) {
    return (
      <div className="n4-pareto-col">
        <h3 className="n4-col-t">Onde atacar primeiro</h3>
        <p style={{ color: "var(--ter)", fontSize: 13, margin: 0 }}>
          Nada contado ainda nesta variável. Conte ao lado e as barras aparecem
          aqui.
        </p>
      </div>
    );
  }

  const maior = Math.max(...itens.map((i) => i.quantidade));

  /*
   * UM contêiner, e não um fragmento.
   *
   * Como fragmento, cada filho -- as barras, a nota de rodapé, o formulário --
   * virava uma CÉLULA do grid de duas colunas: a nota do Pareto aparecia
   * embaixo da grade, na coluna errada. Fragmento é transparente para o
   * layout, e é justamente isso que não serve dentro de um grid.
   *
   * Sem moldura própria: a seção que envolve tudo já é o cartão. Caixa dentro
   * de caixa era o que fazia o bloco parecer errado.
   */
  return (
    <div className="n4-pareto-col">
      <h3 className="n4-col-t">Onde atacar primeiro</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/*
          O NOME em cima, INTEIRO, e a barra embaixo.

          Antes ele dividia a linha com a barra, em 200px fixos, e cortava:
          "Falta de produto - produto não localizado (Dep. 17)" virava "Falta de
          produto - produto n...". É a frase que a reunião discute -- cortá-la
          para caber uma barra é trocar o conteúdo pelo enfeite.

          Empilhar não custa altura de verdade: são poucas causas, e as que
          importam são as vitais, que ficam no topo.
        */}
        {itens.map((i) => (
          <div key={i.pontoCausaId} className="n4-pareto-item">
            <div className="n4-pareto-nome">{i.nome}</div>
            <div className="n4-pareto-medida">
              <div className="n4-barra-trilha">
                <div
                  className={`n4-barra ${i.vital ? "vital" : ""}`}
                  style={{ width: `${(i.quantidade / maior) * 100}%` }}
                />
              </div>
              <div className="n4-pareto-num">
                <strong>{i.quantidade}</strong> · {i.percentual.toFixed(0)}%
              </div>
              <button
                type="button"
                className="n4-btn-acao"
                title={`Abrir contramedida para "${i.nome}"`}
                onClick={() => setCausa({ id: i.pontoCausaId, nome: i.nome })}
              >
                + Ação
              </button>
            </div>
          </div>
        ))}
      </div>

      {/*
        A causa, a loja e o QUADRO vão travados para o formulário: quem abre
        daqui acabou de discutir esta barra, e deixar trocá-los desfaria a
        ligação com o que a reunião viu.

        A gerência vai SUGERIDA, não travada: o formulário abre na do quadro
        e o gerente pode trocar, porque o problema de uma área nem sempre para
        na fronteira da gerência. Ver §7.32.
      */}
      <AbrirAcao
        aberto={causa !== null}
        onFechar={() => setCausa(null)}
        {...(causa
          ? {
              pre: {
                pontoCausaId: causa.id,
                pontoCausaNome: causa.nome,
                filial,
                gerenciaNome,
                origem: `Pareto · ${contexto}`,
              },
            }
          : {})}
      />

      <p className="n4-nota">
        <span aria-hidden>ⓘ</span>O Pareto prioriza, não explica. Ele diz por
        onde começar; a causa raiz sai da discussão em frente ao quadro.
      </p>
    </div>
  );
}

/**
 * O percentual de VENDAS de uma área, ou `null`.
 *
 * **Uma definição só**, porque agora dois lugares dependem dela: o número que a
 * linha mostra e a ORDEM em que as linhas aparecem. Escrita duas vezes, bastaria
 * uma delas ganhar o `> 0` e a lista passaria a estar ordenada por um número
 * diferente do que ela exibe — a pior forma de erro de ordenação, porque a tela
 * parece só estar embaralhada.
 *
 * `denominador > 0` além do `!== null`: meta zero daria divisão que o servidor
 * já devolve como nula, mas a checagem fica porque é ela que diz o que "sem
 * meta" significa aqui.
 */
function pctDeVendas(vendas: AreaPerformance | undefined): number | null {
  return vendas && vendas.denominador !== null && vendas.denominador > 0
    ? vendas.percentual
    : null;
}

/**
 * O bloco "o que já está sendo feito" desta gerência.
 *
 * Só a BUSCA mora aqui: o desenho é o `BlocoDeAcoes`, que a reunião do N3
 * também usa (11/09/2026). O recorte é que difere — lá é o quadro da loja,
 * aqui é a gerência.
 */
function AcoesDaGerenciaN4({ gerenciaId }: { gerenciaId: string }) {
  const consulta = useAcoesDaGerencia(gerenciaId)
  /*
   * `?? []` e não `!`: enquanto a consulta não responde, `data` é `undefined` e
   * a lista vazia é a resposta certa para "quantas ações mostrar agora".
   */
  const todas: ResumoAcao[] = consulta.data?.contramedidas ?? []

  if (consulta.isLoading) return null

  return (
    <BlocoDeAcoes
      acoesAbertas={todas.filter((a) => a.status !== 'CONCLUIDA')}
      vazio="Nenhuma ação aberta nesta gerência"
    />
  )
}

/**
 * A linha da área: os INDICADORES dela, e a CONTAGEM dela.
 *
 * A grade voltou para cá em 09/09/2026 (§7.59), depois de dez dias no bloco da
 * gerência (§7.26). O motivo de sair era o Pareto a 2.600px de rolagem embaixo
 * de onze acordeões; o motivo de voltar é outro e é do GD: conta-se onde o
 * problema aparece. Os dois convivem porque a lista mostra TRÊS áreas por
 * padrão (§7.59, herdando o corte de §7.31) — não onze —, e o que a reunião
 * discute continua sendo a soma,
 * no bloco de fora.
 *
 * A atribuição por área não é o ponto: é o somatório. Marcar na área é onde o
 * gesto cabe, não uma dimensão nova para cortar relatório.
 */
function CartaoArea({
  areaVendaId,
  vendedor,
  vendas,
  variaveis,
  semana,
  faiscaVendedor,
  faiscaVendas,
  contagem,
}: {
  areaVendaId: string;
  vendedor: AreaVendedor | undefined;
  vendas: AreaPerformance | undefined;
  /** Para ler a META de cada variável. A marcação usa a de `contagem`. */
  variaveis: Gerencia["categorias"][number]["variaveis"];
  /** Qual ponto a faísca destaca. Não marca nada — só aponta onde se está. */
  semana: number;
  /** As cinco semanas DESTA área. Ausentes enquanto a série não chegou. */
  faiscaVendedor?: Array<number | null>;
  faiscaVendas?: Array<number | null>;
  /**
   * A grade de contagem desta área. Ausente quando a gerência não acompanha
   * variável nenhuma — aí não há o que contar, e um cabeçalho vazio prometeria
   * uma grade que nunca vem.
   */
  contagem?: {
    variavelId: string;
    /** O NOME, para o botão dizer o que conta. Ver `Grade`. */
    variavel: string;
    gerenciaId: string;
    ano: number;
    mes: number;
  };
}) {
  const area = vendedor ?? vendas;
  if (!area) return null;

  const metaDe = (nome: string) =>
    variaveis.find((v) => v.nome.toLowerCase().includes(nome))?.meta ?? null;

  const pctVendas = pctDeVendas(vendas);
  const pctVendedor = vendedor?.percentual ?? null;

  /**
   * O VEREDITO É DE VENDAS. Decisão do analista, 31/08/2026: *"só olhe para
   * vendas, 100%"*.
   *
   * Era "fora da meta se QUALQUER uma estiver fora", incluindo Vendedor. Mas
   * Performance Vendedor é "% dos vendedores que cumpriram cota", e exigir um
   * patamar dela poria em vermelho toda equipe com um vendedor abaixo — o
   * indicador vira alarme constante e para de informar.
   *
   * Vendedor CONTINUA NA TELA, e continua sendo o que a reunião discute: "4 de
   * 10 vendedores" diz mais sobre o dia do que o selo. O que ele não faz é
   * emitir veredito.
   */
  // Alvo 100 por definição (achievement), não patamar cadastrado. Ver ALVO_PERFORMANCE.
  const ok = naMeta(pctVendas, ALVO_PERFORMANCE);

  /*
    A grade fica ABERTA, e não atrás de um acordeão.

    Ela voltou para cá em 09/09/2026 (§7.59). Pôr um "abrir" na frente devolveria
    o defeito que fez a marcação sair daqui em agosto: com a grade escondida,
    ninguém sabe se a área foi contada ou se só não foi aberta -- e o total do
    bloco de baixo passa a depender de um clique que não deixa rastro.

    O custo é a altura, e ele é pago pelo "Ver todas": a lista mostra três áreas
    por padrão — as três PIORES (§7.59). Construção tem treze; sem o recorte
    seriam treze grades
    numa tela só.
  */
  return (
    <section
      /*
        Sem a classe `alerta`: ela existia só para a regra de borda vermelha
        que virou a tarja inline abaixo, e nenhuma outra regra do
        `reuniao-n4.css` a usava. Conferido antes de tirar.
      */
      className="n4-linha"
      /* Verde na meta, vermelho fora, cinza sem meta. Ver `tarjaDoFarol`. */
      style={{ borderLeft: `4px solid ${tarjaDoFarol(ok)}` }}
    >
      <div className="n4-cabeca estatica">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="n4-nome">{nomeLegivel(area.nome)}</div>
          <div className="n4-sup">
            {area.supervisor
              ? nomeLegivel(area.supervisor)
              : "sem supervisor cadastrado"}
          </div>
        </div>

        {/* Vendas antes de vendedores, como no topo: o fato, depois quem o sustentou. */}
        <BlocoVariavel
          rotulo="Vendas na meta"
          icone="R$"
          percentual={pctVendas}
          semana={semana}
          {...(faiscaVendas ? { faisca: faiscaVendas } : {})}
          meta={ALVO_PERFORMANCE}
          /*
           * TRÊS estados diferentes, e confundi-los manda consertar a coisa
           * errada:
           *
           *  - a área NÃO VEIO na resposta → a carga de vendas ainda não
           *    alcançou esta semana. Dizer "meta não cadastrada" aqui mandaria
           *    cadastrar meta quando o problema é carga — e acontece toda
           *    semana, porque `vendas-linha` anda alguns dias atrás de
           *    `vendedor-dia`;
           *  - veio com denominador nulo → meta de fato não cadastrada;
           *  - veio com número → a fração.
           */
          /*
            "Vendas x · Meta y", com o farol SÓ no valor de vendas.

            A meta é a RÉGUA: não está boa nem ruim, e pintar as duas poria duas
            afirmações de estado numa linha que tem uma. Mesma forma do cartão
            de gerência no N3 -- são a mesma frase em duas telas.

            "de" saiu porque não dizia qual era qual: "33,95 de 31,54" se lê
            como fração, e em fração o segundo número é o total -- aqui ele é a
            meta, e o primeiro pode ser maior.
          */
          fracao={
            !vendas ? (
              "sem venda carregada até esta semana"
            ) : vendas.denominador !== null ? (
              <>
                <span className="n4-comp-rot">Vendas</span>{" "}
                <span
                  className={corDoFarol(naMeta(pctVendas, ALVO_PERFORMANCE))}
                >
                  {dinheiro(vendas.numerador)}
                </span>
                <span className="n4-comp-sep" aria-hidden />
                <span className="n4-comp-rot">Meta</span>{" "}
                {dinheiro(vendas.denominador)}
              </>
            ) : (
              "meta não cadastrada"
            )
          }
        />
        <BlocoVariavel
          rotulo="Vendedores na meta"
          icone="👤"
          percentual={pctVendedor}
          meta={metaDe("vendedor")}
          fracao={
            vendedor && vendedor.denominador > 0
              ? `${vendedor.numerador} de ${vendedor.denominador} vendedores`
              : "ninguém na conta"
          }
          semana={semana}
          {...(faiscaVendedor ? { faisca: faiscaVendedor } : {})}
        />

        <Selo ok={ok} />
      </div>

      {contagem && (
        <Grade
          variavelId={contagem.variavelId}
          variavel={contagem.variavel}
          gerenciaId={contagem.gerenciaId}
          areaVendaId={areaVendaId}
          ano={contagem.ano}
          mes={contagem.mes}
          semana={semana}
          enquadre="nu"
        />
      )}
    </section>
  );
}

/**
 * O SELETOR DE VARIÁVEL — o que a contagem das áreas está contando.
 *
 * Componente à parte porque ele é a peça que mais mudou de lugar nesta tela
 * (§7.64 do PLANO tem a tabela das tentativas): mantê-lo inteiro num só bloco
 * é o que deixou mover barato.
 */
function SeletorVariavel({
  variaveis,
  atual,
  trocar,
}: {
  variaveis: Gerencia["categorias"][number]["variaveis"];
  atual: string | null;
  trocar: (id: string) => void;
}) {
  return (
    <div className="n4-seg-caixa">
      <span className="n4-seg-rot">Contando causas de</span>
      <div className="n4-seg">
        {variaveis.map((v) => (
          <button
            key={v.id}
            type="button"
            className={v.id === atual ? "on" : ""}
            onClick={() => trocar(v.id)}
          >
            {v.nome}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReuniaoN4() {
  const { usuario } = useSessao();
  const hoje = new Date();
  /*
   * O mês e o ano vêm do PERÍODO GLOBAL, o do cabeçalho.
   *
   * Esta tela tinha um par de `select` próprio, com `useState` local. Duas
   * peças de interface para a mesma decisão, e a do cabeçalho não fazia nada
   * aqui: dava para deixar "Setembro" lá em cima e "Agosto de 2026" no corpo da
   * tela, ao mesmo tempo, sem nenhum aviso de que só um dos dois valia.
   *
   * `modo: 'ano'` não tem mês, e esta tela é de UMA semana de UM mês -- cai no
   * mês corrente, que é o recorte da reunião. É a mesma escolha da tela de
   * indicador (`SecaoVariaveis`).
   */
  const { periodo } = usePeriodo();
  const ano = periodo.ano;
  const mes = periodo.modo === "mes" ? periodo.mes : hoje.getMonth() + 1;
  const [semana, setSemana] = useState(semanaAtual(hoje));
  /*
   * Qual variável a grade conta. Estava dentro de cada área; subiu junto com o
   * bloco — a marcação é uma por reunião, e a escolha também. Ver §7.26.
   */
  const [variavelDoQuadro, setVariavelDoQuadro] = useState<string | null>(null);

  /*
   * FILIAL e GERÊNCIA não são escolhidas nesta tela — **a reunião é de uma
   * área só, e quem é dela já se sabe.**
   *
   * A filial vem da visão; a gerência, do perfil de quem entrou. O seletor de
   * gerência que existia aqui saiu em 28/08/2026: ele deixava o adjunto de Não
   * Construção abrir Construção, que é a reunião de outra pessoa.
   */
  const { params: visao, chave, pedido, definir } = useVisao();

  const gerencias = useGerencias({ visao, chave, ano, mes });
  const lista = gerencias.data?.gerencias ?? [];

  /**
   * Qual gerência o quadro abre, em três tentativas:
   *
   *   1. a que a VISÃO nomeia — o administrador escolheu no cabeçalho
   *   2. a de QUEM ENTROU, marcada pelo servidor em `minha`
   *   3. a primeira da lista
   *
   * A visão é casada por NOME e não por id: o id é por (filial, gerência), e
   * guardá-lo faria "Não Construção da CEN" seguir escolhida ao trocar para a
   * NOR, apontando para uma linha que não é daquela loja.
   *
   * A terceira é último recurso, não padrão. Ela atende quem não tem gerência
   * própria nem escolheu nenhuma — hoje, quem abre esta tela sem ser N4 de
   * venda. Abrir na gerência errada não dá erro: dá a reunião errada.
   */
  const daVisao = pedido?.gerencia
    ? (lista.find((x) => x.nome === pedido.gerencia)?.id ?? null)
    : null;
  const minha = lista.find((x) => x.minha)?.id ?? null;

  /**
   * A ESCOLHA DELE vence tudo — o quadro ABRE na dele, não fica preso nela.
   *
   * Um gerente de Construção precisa olhar Não Construção: a loja é uma só, e
   * áreas conversam entre si. Abrir na dele economiza um clique por dia;
   * trancar ali economiza o clique e tira a visão.
   *
   * Validada contra a LISTA, sem `useEffect`: trocar de filial no cabeçalho
   * troca a lista inteira, e um id guardado de outra loja apontaria para uma
   * gerência que não é dela. Um id que não está na lista simplesmente não
   * conta, e a cadeia de padrões assume de novo.
   */
  /*
   * A ESCOLHA VIVE NA URL (`?gerencia=<id>`), e não em `useState`.
   *
   * Porque ela deixou de ser só do seletor: o cartão de gerência do N3 é um
   * link para cá, e um link precisa de endereço. Com a escolha na URL, as três
   * coisas passam a funcionar de graça -- o link do N3 abre na gerência certa,
   * o botão "voltar" do navegador desfaz a troca, e o endereço pode ser
   * copiado para outra aba.
   *
   * `replace: true` no seletor: trocar de gerência dentro do quadro não é um
   * passo de navegação, é ajuste de recorte. Sem isso, cinco cliques no
   * seletor exigiriam cinco "voltar" para sair da tela.
   */
  const [busca, setBusca] = useSearchParams();
  const escolhida = busca.get("gerencia");

  /*
   * VEIO DO N3? A marca é `de=n3`, e não a presença de `gerencia`.
   *
   * Usar `gerencia` como marca parecia bastar -- só o link do N3 o escrevia --
   * até que o SELETOR desta tela passou a escrever o mesmo parâmetro. Medido:
   * abrir `/reuniao` direto não mostrava o botão (certo), e trocar de gerência
   * no seletor fazia ele aparecer (errado). Um N4 no próprio quadro ganhava um
   * "Voltar para o N3" que nunca pediu.
   *
   * Com marca própria os quatro casos ficam certos: o link do N3 traz `de=n3`;
   * trocar de gerência PRESERVA a marca (quem veio da loja continua vindo
   * dela); abrir direto não tem marca; e trocar de gerência sem marca continua
   * sem.
   */
  const veioDoN3 = busca.get("de") === "n3";
  const daEscolha = lista.some((x) => x.id === escolhida) ? escolhida : null;
  const atual = daEscolha ?? daVisao ?? minha ?? lista[0]?.id ?? null;
  const g = lista.find((x) => x.id === atual);

  /**
   * PUBLICA O AVISO DE PROCEDÊNCIA para o cabeçalho — "você veio do N3".
   *
   * `pedido === null` porque os dois avisos não podem se somar: quem simula já
   * tem a pastilha de visão dizendo onde está e como sair. Duas pastilhas
   * iguais, com dois destinos diferentes de "voltar", é a pergunta "qual dos
   * dois?" no topo da tela.
   *
   * Campos simples e nenhum nó de React: é o que deixa o contexto comparar
   * publicações por conteúdo e não entrar em laço de render.
   */
  const { publicarAviso } = useAvisoDaTela();
  const nomeDaGerencia = g ? nomeLegivel(g.nome) : "";
  const filialDoAviso = usuario?.filial ?? "";
  useEffect(() => {
    if (!veioDoN3 || pedido !== null) {
      publicarAviso(null);
      return;
    }
    publicarAviso({
      forte: `Você abriu o N4${nomeDaGerencia ? ` de ${nomeDaGerencia}` : ""}`,
      resto: ` a partir da reunião do N3${filialDoAviso ? ` · ${filialDoAviso}` : ""}.`,
      para: "/reuniao-n3",
      rotulo: "Voltar para o N3",
    });
    return () => {
      publicarAviso(null);
    };
  }, [publicarAviso, veioDoN3, pedido, nomeDaGerencia, filialDoAviso]);

  /**
   * QUEM OLHA DE CIMA vê o bloco "o que já está sendo feito".
   *
   * Foi só o N3 primeiro (§7.61, *"só aparece no N4 na visão do N3"*), e o
   * analista estendeu no mesmo dia: *"quero que o N2 também possa ver o que
   * está sendo feito"*. A regra passou a ser por POSIÇÃO na cadeia de ajuda, e
   * não por um nível nomeado — o que também a deixa certa sozinha no dia em que
   * o N1 aparecer.
   *
   * Quem olha de cima passa por várias gerências e precisa saber o que está em
   * pé em cada uma. O N4 é o único que fica de fora, e por um motivo dele: o
   * quadro de Ações dele já é a lista completa das ações dele, e repeti-la
   * dentro da própria reunião daria duas listas para uma pergunta.
   *
   * DOIS caminhos, e nenhum dos dois basta sozinho:
   *
   *  - `nivelDeQuemOlha` acima do N4 cobre o N3 e o N2 de verdade, inclusive
   *    quem abre esta tela direto pela URL;
   *  - `veioDoN3` cobre quem chegou pelo cartão da gerência no N3 com visão de
   *    N4 -- está fazendo o trabalho do N3, seja qual for o cadastro.
   *
   * O nível EFETIVO, e não `usuario.nivel`: com a visão trocada no cabeçalho
   * quem manda é o pedido. Ler o cadastro aqui faria o seletor não valer nesta
   * decisão — o mesmo defeito que apareceu quatro vezes em 10/09/2026, e que
   * `lib/quadro-do-nivel.ts` registra.
   */
  const nivelDeQuemOlha = pedido?.nivel ?? usuario?.nivel ?? null;
  const olhandoDeCima =
    nivelDeQuemOlha === "N3" || nivelDeQuemOlha === "N2" || veioDoN3;

  const vendas = usePerformanceVendas(atual, ano, mes, semana);
  const vendedor = usePerformanceVendedor(atual, ano, mes, semana);
  /* Uma faísca por KPI: a rota devolve uma série para cada variável. */
  const serie = useSerieSemanal(atual, ano, mes);
  const faiscaVendedor = new Map(
    (serie.data?.vendedor.areas ?? []).map((a) => [a.areaVendaId, a.serie]),
  );
  const faiscaVendas = new Map(
    (serie.data?.vendas.areas ?? []).map((a) => [a.areaVendaId, a.serie]),
  );

  /*
   * O GD desta gerência, e as variáveis dele.
   *
   * A categoria sai do indicador — ver PLANO §7.11 —, e categoria sem variável
   * não é desenhada.
   *
   * ERA `find((c) => c.indicador === 'vendas')`, com o código cravado. Hoje o
   * portal só tem o GD de Vendas, então dava no mesmo -- e é justamente por
   * isso que era perigoso: no dia em que uma gerência pertencesse ao GD de
   * Logística Interna, o `find` não acharia nada, `variaveis` viria vazio, e o
   * quadro abriria SEM KPI NENHUM. Sem erro, sem aviso, sem nada na tela
   * dizendo que a pergunta era outra.
   *
   * Pegando a categoria que a gerência TEM, a tela mostra o GD dela ou deixa
   * claro que não há nenhum.
   */
  const categoria = g?.categorias[0] ?? null;
  const variaveis = categoria?.variaveis ?? [];
  /* Sem escolha, a primeira — o quadro nunca abre com o bloco vazio. */
  const variavelAtual = variavelDoQuadro ?? variaveis[0]?.id ?? null;
  const nomeDoQuadro =
    variaveis.find((v) => v.id === variavelAtual)?.nome ?? "Variável";
  /*
   * Só Vendas: Vendedor não tem patamar de propósito (§7.37), e o resumo por
   * isso desenha a barra dele sem alvo. A meta de cada ÁREA continua vindo do
   * `metaDe` da própria linha.
   */
  const metaVendas =
    variaveis.find((v) => v.nome.toLowerCase().includes("vendas"))?.meta ??
    null;

  /**
   * PUBLICA O GD DESTA REUNIÃO — a tela do N4 nunca publicou o dela.
   *
   * O N3 publica a lista desde 11/09/2026, e o cabeçalho desenha as abas. Aqui
   * não havia publicação nenhuma, e o recorte saía sem o pedaço mais importante
   * para quem está na reunião: `GD N4 · Gerência adjunta · NOR` não diz de qual
   * Gerenciamento Diário a gerência é.
   *
   * **Um item, sempre** — a gerência pertence a UM GD (`categorias[0]`, ver o
   * comentário de `categoria`). O cabeçalho trata lista de um como TEXTO no
   * título, e não como aba: trilha de um item não é trilha, que é a mesma regra
   * que matou o breadcrumb.
   *
   * `trocar` não faz nada porque não há para onde trocar. Quando uma gerência
   * pertencer a mais de um GD, esta lista cresce e as abas aparecem sozinhas --
   * sem mexer no cabeçalho.
   *
   * E LIMPA AO SAIR, a metade fácil de esquecer: sem o `return`, o GD desta
   * reunião continuaria no cabeçalho sobre a tela de Ações.
   */
  const { publicar } = useGdsDaTela();
  const gdDaTela = categoria
    ? { codigo: categoria.indicador, nome: categoria.nome }
    : null;
  const codigoDoGd = gdDaTela?.codigo ?? null;
  const nomeDoGd = gdDaTela?.nome ?? null;

  useEffect(() => {
    if (codigoDoGd === null || nomeDoGd === null) {
      publicar(null);
      return;
    }
    publicar({
      lista: [{ codigo: codigoDoGd, nome: nomeDoGd }],
      ativo: codigoDoGd,
      trocar: () => undefined,
    });
    return () => {
      publicar(null);
    };
  }, [publicar, codigoDoGd, nomeDoGd]);

  const porArea = new Map(vendedor.data?.areas.map((a) => [a.areaVendaId, a]));
  const vendasPorArea = new Map(
    vendas.data?.areas.map((a) => [a.areaVendaId, a]),
  );

  /*
   * ÁREA SEM VENDEDOR APTO NÃO É DESENHADA.
   *
   * "Apto" é quem entra no denominador: classificado, ativo e com cota. Uma
   * área onde ninguém preenche isso não tem o que discutir na reunião -- ela
   * ocupava uma linha do quadro com dois traços, e linha vazia numa reunião de
   * quinze minutos ensina o grupo a passar o olho por cima. Mesma regra da
   * categoria sem variável, no §7.11.
   *
   * O FILTRO É DA TELA, não da rota: a rota continua devolvendo a área zerada,
   * e há teste disso. Esconder no servidor tiraria o dado de qualquer outro
   * consumidor -- inclusive de quem for investigar por que a área sumiu.
   *
   * SÓ FILTRA QUANDO A CONTA FOI POSSÍVEL. Sem `corte` (falta o calendário, ou
   * o mês não começou) TODA área tem denominador zero, e o filtro esvaziaria o
   * quadro inteiro -- falta de carga viraria "não há o que ver".
   */
  const podeFiltrar = vendedor.data?.corte != null;
  const areas = (g?.areasVenda ?? []).filter(
    (a) => !podeFiltrar || (porArea.get(a.id)?.denominador ?? 0) > 0,
  );

  /*
   * O DESTAQUE SAIU, e com ele o "Ver todas" (09/09/2026).
   *
   * §7.31 promovia três áreas por gerência, nomeadas no cadastro -- Pisos,
   * Metais e Tintas na Construção. O analista desfez: *"pode tirar os 3
   * primeiros que foram mockados"*. Eram escolha de exemplo, não de gestão.
   *
   * O que substituiu não é "mostrar tudo": é a ORDEM. A lista abre pela área de
   * pior desempenho, e quem lê para de ler quando quiser -- que é o que os três
   * fixos tentavam fazer, sem saber qual das três estava pior. E cabe porque a
   * grade de pontos de causa nasce fechada: treze áreas são treze linhas, não
   * treze tabelas.
   *
   * A coluna `destaque` continua no banco. É cadastro do portal, não da carga,
   * e apagá-la seria jogar fora a escolha registrada em §7.31 para desfazer uma
   * leitura de tela. Nenhuma tela a lê hoje.
   *
   * **O corte em três voltou**, e agora `slice(0, 3)` é o certo. O comentário
   * antigo proibia justamente isso -- "cortar em três fixos promoveria uma área
   * que ninguém escolheu" -- e ele estava certo enquanto a ordem era o cadastro:
   * a quarta da lista alfabética não tinha por que subir. Com a ordem sendo o
   * desempenho, as três de cima são as três piores, e é essa a lista que a
   * reunião quer aberta.
   */
  const [verTodas, setVerTodas] = useState(false);
  const QUANTAS_ABERTAS = 3;

  /**
   * QUAL histórico está aberto: o de Vendas, o de Vendedor, ou nenhum.
   *
   * Um estado e não dois booleanos: os dois abertos ao mesmo tempo obrigariam a
   * procurar qual dos gráficos responde o número que se acabou de olhar, e o
   * pedido é que cada cartão leve AO SEU. Clicar no mesmo link fecha; clicar no
   * outro troca.
   *
   * `useRef` + `useEffect` para LEVAR a tela até o gráfico: os links ficam no
   * topo e os gráficos ficam depois das áreas, e revelar algo fora da vista sem
   * rolar até lá se lê como link que não fez nada.
   *
   * `block: 'start'` e não `'center'`: o gráfico é alto, e o que interessa é
   * começar pelo título -- centralizar cortaria as barras ao meio.
   *
   * A dependência é o VALOR, não um booleano de "está aberto": trocar de Vendas
   * para Vendedor mantém a seção aberta, e com um booleano o efeito não
   * dispararia -- a tela ficaria parada no gráfico anterior, que acabou de sair
   * da tela.
   */
  const [historico, setHistorico] = useState<"vendas" | "vendedor" | null>(
    null,
  );
  const ondeEstaOHistorico = useRef<HTMLDivElement>(null);
  /**
   * O TOPO, para a volta.
   *
   * O "Ver histórico" desce a tela até o fim da página, e a subida ficava por
   * conta da rolagem — numa tela que tem três áreas com grade, o Pareto e o
   * somátorio no caminho. Pedido do analista: *"desce a navegação, queria algo
   * para subir novamente"*.
   *
   * O gesto é simétrico: o link abre e desce, o botão do fim fecha e sobe. Sem
   * fechar, voltar ao topo deixaria o gráfico aberto lá embaixo e o link do
   * cartão dizendo "Ocultar histórico" para algo fora da vista.
   */
  const ondeEstaOTopo = useRef<HTMLDivElement>(null);
  /**
   * A ALTURA DA FAIXA DA GERÊNCIA, publicada para quem gruda embaixo dela: a
   * faixa de aviso e a peça solta do seletor. Ver `useAlturaDaFaixa`.
   */
  const aFaixa = useAlturaDaFaixa("--altura-faixa-identidade");
  /**
   * O SELETOR SOLTO — a peça que fica quando o cabeçalho da lista sai da tela.
   *
   * Escolha do analista entre três opções, depois de recusar as três tentativas
   * de fixar a linha inteira: *"só o seletor gruda"*. O motivo é geométrico, e
   * não de cor: linha inteira fixa é um retângulo opaco de 1288px cortando os
   * cartões que sobem — *"esse quadradão atrás tá muito esquisito"*. Uma peça de
   * ~300px não vira retângulo, vira objeto.
   *
   * O par abaixo é o que garante UM seletor à vista: a peça só existe enquanto o
   * seletor do cabeçalho está fora da tela. Nunca há dois, e nunca a pergunta
   * "qual dos dois vale".
   *
   * A margem negativa no topo desconta o cabeçalho do portal e a faixa da
   * gerência: sem ela o seletor conta como visível enquanto está ESCONDIDO
   * atrás delas, e a peça só apareceria 180px de rolagem depois.
   */
  const [oSeletor, setOSeletor] = useState<HTMLElement | null>(null);
  const [seletorNaTela, setSeletorNaTela] = useState(true);
  /*
   * A CONTA É FEITA A CADA ROLAGEM, e não uma vez na criação de um
   * `IntersectionObserver`. A primeira versão usava o observador com
   * `rootMargin` negativo, e tinha dois defeitos que só apareciam na visão
   * simulada -- foi o que o analista viu: *"visão do N4 pelo N2 tá bugando o
   * filtro de contador de causa"*.
   *
   * O primeiro: o `rootMargin` descontava DUAS faixas (o cabeçalho do portal e
   * a da gerência) e existem TRÊS quando o N2 simula — a faixa laranja de visão
   * entra no meio. O seletor do cabeçalho ficava escondido atrás dela e mesmo
   * assim contava como visível: nenhum seletor à vista, nem o de cima nem a
   * peça.
   *
   * O segundo é estrutural e valeria a correção sozinho: `rootMargin` é fixado
   * no instante em que o observador nasce, então ele NUNCA enxerga uma faixa
   * que muda de altura, entra ou sai depois. Somar a terceira variável ali só
   * mudaria o valor errado de lugar.
   *
   * Lendo as três a cada evento, a conta está sempre atual — inclusive quando
   * uma faixa quebra em duas linhas ao estreitar a janela. `passive` porque
   * isto nunca cancela a rolagem.
   */
  useEffect(() => {
    if (oSeletor === null) return;
    const medir = () => {
      setSeletorNaTela(
        apareceAbaixoDasFaixas(
          oSeletor.getBoundingClientRect(),
          alturaDasFaixasFixas(getComputedStyle(document.documentElement)),
        ),
      );
    };
    medir();
    window.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, [oSeletor]);
  useEffect(() => {
    if (historico === null) return;
    ondeEstaOHistorico.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [historico]);

  /*
   * Só entram as que TÊM dado. `CartaoArea` devolve null sem vendedor e sem
   * venda, e contar essas no total produzia uma casca: numa semana no futuro a
   * tela mostrava "O que aconteceu" e zero cartões.
   */
  /**
   * PIOR PRIMEIRO.
   *
   * O critério é VENDAS, o mesmo do selo de cada linha e do contador do
   * cabeçalho (§7.37): *"só olhe para vendas, 100%"*. Ordenar por Vendedor
   * poria em cima a equipe com um vendedor abaixo da cota, que é outra
   * conversa.
   *
   * A meta de vendas é a MESMA para todas as áreas da gerência — ela vem da
   * variável de controle, não do cadastro da área —, então ordenar pelo
   * percentual e ordenar pela distância até a meta dão a mesma lista. Se um dia
   * a meta passar a ser por área, esta função é o lugar de mudar.
   *
   * **Sem percentual vai para o FIM**, e não para o começo: uma área sem meta
   * cadastrada, ou que a carga de vendas ainda não alcançou, não está com o
   * pior desempenho — está sem desempenho medido. Pô-la no topo faria a reunião
   * abrir por um traço.
   *
   * Empate desempatado pelo NOME. Sem isso duas áreas com o mesmo percentual
   * trocariam de lugar entre recarregadas, e numa reunião isso lê como "mudou
   * alguma coisa" quando nada mudou — a mesma razão do desempate do Pareto.
   */
  const piorPrimeiro = (
    a: { id: string; nome: string },
    b: { id: string; nome: string },
  ) => {
    const pa = pctDeVendas(vendasPorArea.get(a.id));
    const pb = pctDeVendas(vendasPorArea.get(b.id));
    if (pa === null && pb === null)
      return a.nome.localeCompare(b.nome, "pt-BR");
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb || a.nome.localeCompare(b.nome, "pt-BR");
  };

  /*
   * `[...]` antes do `sort`: ele ordena NO LUGAR, e `areas` deriva de
   * `g.areasVenda`, que é o objeto do cache da consulta. Ordenar ali mexeria no
   * cache do TanStack Query -- a mesma lista, embaralhada por baixo, para toda
   * tela que a leia depois.
   */
  const comDado = [...areas]
    .filter((a) => porArea.has(a.id) || vendasPorArea.has(a.id))
    .sort(piorPrimeiro);
  const visiveis = verTodas ? comDado : comDado.slice(0, QUANTAS_ABERTAS);

  /*
   * Conta pelo mesmo critério do selo de cada linha: VENDAS (§7.37). Contar
   * também Vendedor faria o número do cabeçalho discordar dos selos logo
   * abaixo -- "9 de 11 fora da meta" com dois selos vermelhos na lista.
   */
  const foraDaMeta = areas.filter(
    (a) =>
      naMeta(vendasPorArea.get(a.id)?.percentual ?? null, metaVendas) === false,
  ).length;

  /*
   * Quantas áreas TÊM resposta -- e é esse o denominador dos chips do resumo.
   * Contar `areas.length` diria "9 de 11 fora da meta" incluindo áreas que
   * ninguém comparou, e a diferença entre "está mal" e "não sei" é a mesma que
   * o resto da tela guarda com cuidado.
   */
  const comMeta = areas.filter(
    (a) =>
      naMeta(vendasPorArea.get(a.id)?.percentual ?? null, metaVendas) !== null,
  ).length;

  /*
   * Semana futura não é clicável. Num mês passado todas já aconteceram; no mês
   * corrente, o limite é a semana de hoje.
   */
  const cores = coresDaGerencia(g?.nome);

  const semanaLimite =
    ano === hoje.getFullYear() && mes === hoje.getMonth() + 1
      ? semanaAtual(hoje)
      : 5;

  return (
    <>
      {/*
        A FAIXA DA GERÊNCIA — o recorte, antes do conteúdo.

        Sangra de ponta a ponta: `-mx-gutter` cancela o padding do `main`, e
        `-mt-[34px]` o espaço acima, para ela encostar na barra de navegação. É
        o que a faz ler como faixa, e não como mais um cartão.

        Aparece SEMPRE, mesmo com uma gerência só -- ela diz por qual quadro
        você responde, e isso é informação com ou sem escolha. O seletor é que
        some quando não há o que escolher: dois botões com um só é ruído.
      */}
      <div
        ref={aFaixa}
        className="n4 n4-faixa -mx-gutter -mt-[34px]"
        /*
          Por variável CSS, e não classe por gerência: a lista vem do banco e
          cresce sem deploy. Uma classe por nome exigiria lembrar de criá-la, e
          a gerência nova nasceria sem cor nenhuma.
        */
        style={
          {
            "--faixa-destaque": cores.destaque,
            "--faixa-tinta": cores.tinta,
          } as CSSProperties
        }
      >
        <div className="n4-faixa-conteudo">
          {/*
            A IDENTIDADE SAIU DAQUI EM 12/09/2026 — subiu para o cabeçalho.

            Ela dizia `● N4 · VENDAS · NOR  Construção`, e o cabeçalho global
            passou a dizer exatamente isso, em toda tela e sem rolar: `GD N4 ·
            Gerência adjunta · NOR · Construção`. O motivo original de ela
            existir — *"quando eu rolo para baixo não aparece a informação que é
            N4, VENDAS NOR"* — continua atendido, por outra peça.

            Sobra na faixa o que é só dela: o SELETOR DE GERÊNCIA, que é a
            escolha que esta tela oferece. E a cor: `--faixa-destaque` e
            `--faixa-tinta` vêm da gerência, e é isso que faz Construção e Não
            Construção se distinguirem de relance.
          */}

          {/*
            O seletor só aparece quando há o que escolher: dois botões com uma
            opção só é ruído. O NOME fica de qualquer jeito -- ele diz por qual
            quadro você responde, e isso é informação com ou sem escolha.
          */}
          {lista.length > 1 && (
            <div className="n4-faixa-seg">
              {lista.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className={x.id === atual ? "on" : ""}
                  onClick={() => {
                    /* PRESERVA a marca de origem: `setBusca` troca a query
                       inteira, e passar só `gerencia` apagaria o `de=n3`. */
                    const q: Record<string, string> = { gerencia: x.id };
                    if (veioDoN3) q.de = "n3";
                    setBusca(q, { replace: true });
                    /*
                     * E o CHIP da visão acompanha, para quem está simulando.
                     *
                     * Sem isto o chip diria a gerência anterior depois de
                     * trocar aqui -- a mesma mentira que §7.65 corrigiu na
                     * descida do N3, um degrau abaixo. O `pedido !== null`
                     * é o que impede de acender a faixa "não é a sua visão"
                     * para o N4 que está na reunião dele.
                     */
                    if (pedido !== null) {
                      definir({
                        nivel: "N4",
                        filial: pedido.filial,
                        gerencia: x.nome,
                      });
                    }
                  }}
                >
                  {nomeLegivel(x.nome)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="n4 mx-auto w-full max-w-[1320px] px-4">
        {/*
        A FAIXA DE PROCEDÊNCIA — "você veio do N3, e volta por aqui".

        Pedido do analista: *"quando tô no N2 e abro o N3 aparece uma barra com
        um texto informando e clicando pra voltar; quero que do N3 pro N4 seja a
        mesma coisa"*. A barra do N2 é a `FaixaVisao`, e ela aparece porque o N2
        passa a SIMULAR a visão do N3; um N3 abrindo a gerência dele não simula
        nada, então não tinha barra nenhuma -- só um link de 12px acima do
        título, que é o que esta faixa substitui.

        A MESMA PEÇA da `FaixaVisao`, e não uma parecida: `FaixaAviso` é a casca
        das duas. Eu tinha dado a esta a paleta azul, com o argumento de que
        laranja é risco e navegação não é risco -- e o analista, vendo as duas
        lado a lado: *"por que esse tá azul e do N2 pro N3 é outra cor? preciso
        que o layout seja padronizado"*. Com a casca compartilhada não há como
        divergirem de novo.

        `pedido === null` porque as duas não podem se somar: quem simula JÁ tem a
        `FaixaVisao` do Layout dizendo onde está e como sair. Duas caixas
        empilhadas, iguais, com dois destinos diferentes de "voltar", é a
        pergunta "qual dos dois?" logo no topo da tela.
      */}
        {/*
          A FAIXA DE PROCEDÊNCIA VIROU PASTILHA NO CABEÇALHO (12/09/2026).

          Ela ocupava uma linha inteira acima do título, e o analista pediu o
          mesmo tratamento que o aviso de visão simulada tinha acabado de
          receber: *"o aviso deveria ficar no header, igual acontece quando o N2
          vai pro GD do N3 e N4"*.

          A tela PUBLICA o texto e o destino; o cabeçalho monta a pastilha (ver
          `AvisoDaTelaContext`). As duas continuam sendo a mesma peça, agora
          pela casca `PastilhaAviso` -- foi divergirem que gerou o *"por que
          esse tá azul e do N2 pro N3 é outra cor?"*.
        */}

        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            {/*
            Só a FILIAL: a gerência subiu para a faixa. Mantê-la aqui também
            diria a mesma coisa duas vezes em quatro centímetros.
          */}
            <div className="n4-olho">
              {pedido?.filial ?? usuario?.filial ?? "—"}
            </div>
            {/*
            O NOME DO GD no título, como no N3.

            O portal terá um GD por domínio, e "Reunião diária" sozinho não diz
            de qual. Aqui não há barra de abas: o N4 é adjunto de UMA gerência,
            que pertence a UM GD -- quem troca de recorte é a faixa de gerência
            logo acima. O nome basta.
          */}
            <h1 className="n4-h1">
              {categoria ? `${categoria.nome} ` : ""}
              <span className="n4-h1-sub">Reunião diária</span>
            </h1>
            {/*
            UMA linha de contexto, e não três.
            
            O mês, o corte da carga e os dias úteis eram três parágrafos
            separados por outros elementos no meio. São a mesma informação --
            "de quando é este quadro" -- e lidos juntos respondem isso de uma
            vez.
          */}
            <p className="n4-sub">
              {MESES[mes - 1]} de {ano}
              {/*
              O CORTE DO VENDEDOR SAIU desta linha (10/09/2026).

              Dizia "· Vendedor: até 09/09 ·". Pedido do analista: tirar. Era a
              data da carga de UMA das fontes num lugar que responde outra
              pergunta -- "de quando é este quadro" --, e a linha já carregava
              o mês, os dias úteis e a contagem de áreas fora da meta.

              O aviso de carga desencontrada CONTINUA, e é ele que faz o
              trabalho de verdade: a linha logo acima só aparece quando os dois
              cortes DIVERGEM, e nomeia a fonte atrasada. Uma data fixa aqui
              informava o tempo todo para avisar de um caso raro.

              Os DIAS ÚTEIS ficam: eles são o denominador da cota rateada, e
              quem lê "26%" de Performance Vendedor precisa saber sobre quantos
              dias.
            */}
              {vendedor.data?.corte && (
                <>
                  {" · "}
                  <strong className="font-semibold text-texto">
                    {vendedor.data.corte.diasUteisDecorridos} de{" "}
                    {vendedor.data.corte.diasUteisDoMes} dias úteis
                  </strong>
                </>
              )}
              {comMeta > 0 && (
                <>
                  {" · "}
                  {/*
                   * ÁREA DE VENDA, e não "linha".
                   *
                   * São duas coisas diferentes no modelo: a área é o recorte do
                   * quadro, com supervisor e indicador próprios; a linha é o
                   * grão de `fato_venda_linha`, um nível abaixo. O cabeçalho
                   * contava áreas e chamava de linhas.
                   *
                   * E o denominador é `comMeta`, não `areas.length` -- é a regra
                   * que o comentário de `comMeta` já registrava, e que este
                   * cabeçalho não seguia: contar quem ninguém comparou mistura
                   * "está mal" com "não sei".
                   */}
                  <strong className={foraDaMeta > 0 ? "n4-ruim" : "n4-ok"}>
                    {/* O helper `areas()` está sombreado aqui pelo array local. */}
                    {foraDaMeta} de {comMeta} área{comMeta > 1 ? "s" : ""} de
                    venda fora da meta
                  </strong>
                </>
              )}
            </p>
          </div>

          <div className="text-right">
            <div className="n4-olho" style={{ marginBottom: 6 }}>
              Semana
            </div>
            <div className="n4-semanas">
              {[1, 2, 3, 4, 5].map((s) => {
                const futura = s > semanaLimite;
                return (
                  <button
                    key={s}
                    disabled={futura}
                    title={
                      futura ? "Semana que ainda não aconteceu" : undefined
                    }
                    className={s === semana ? "on" : ""}
                    onClick={() => setSemana(s)}
                  >
                    S{s}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {/*
        O BLOCO I DO GD — o Compromisso — NÃO ESTÁ NESTA FASE.
        
        O protótipo tem a faixa com propósito, metas do ciclo, histórico e
        equipe. Ela chegou a ser construída e saiu por decisão do analista
        (28/08/2026): o conteúdo é do negócio, precisa ser desdobrado COM a
        equipe, e uma faixa com texto de exemplo no alto da tela seria lida
        como se fosse o propósito de verdade.
        
        Fica registrado no PLANO como pendência de fase seguinte. O formato
        está pronto no protótipo; falta o conteúdo.
      */}

        {gerencias.isLoading && (
          <p className="text-sm text-slate-500">Carregando…</p>
        )}
        {!gerencias.isLoading && lista.length === 0 && (
          <p className="text-sm text-slate-500">
            Nenhuma gerência atribuída a você. É cadastro, não erro — fale com a
            administração.
          </p>
        )}

        {/*
        `corte` nulo é a resposta "não dá para comparar", e ela tem aviso
        próprio. Desenhar a linha zerada seria dizer que ninguém bateu meta.
      */}
        {vendedor.data && !vendedor.data.corte && areas.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>
              Performance Vendedor não pode ser calculada em {MESES[mes - 1]}.
            </strong>{" "}
            Falta o calendário de dias úteis da filial, ou o mês ainda não
            começou. A cota é mensal e precisa ser rateada pelos dias já
            trabalhados — comparar contra a cota cheia reprovaria todo mundo e o
            quadro ficaria vermelho por falta de carga.
          </div>
        )}

        {/*
        OS DOIS CORTES, quando divergem — e eles divergem: cada variável é
        limitada pela janela da PRÓPRIA carga, e medido em 29/08 `vendas-linha`
        estava em 23/08 contra 27/08 de `vendedor-dia`. Sem dizer, a tela põe
        dois números lado a lado que não são do mesmo instante.
      */}
        {vendas.data?.corte &&
          vendas.data.corte !== vendedor.data?.corte?.data && (
            <p className="mb-1 text-xs text-slate-500">
              Vendas: até {vendas.data.corte.slice(8)}/
              {vendas.data.corte.slice(5, 7)} — a carga desta fonte está em
              outro dia
            </p>
          )}

        {/*
        A NOTA DAS ÁREAS ESCONDIDAS SAIU (10/09/2026).

        Dizia "N áreas sem vendedor apto — fora do quadro. Apto é quem tem
        cota, está ativo e conta no mês". Pedido do analista: tirar.

        Ela explicava a REGRA de um filtro num lugar em que ninguém está
        perguntando pela regra: a reunião abre por "como estamos", e a nota
        gastava a primeira linha da tela definindo "apto". O filtro em si
        continua (ver `podeFiltrar`, acima) -- o que saiu é o texto.

        A contagem `escondidas` saiu junto, e eu tinha escrito aqui que ela
        ficaria "porque a conta é o filtro". Não era: o filtro é o `.filter` de
        `areas`, e ela só contava a diferença para esta frase. O lint acusou na
        hora -- e é o tipo de afirmação que, sem ele, ficaria no arquivo
        descrevendo um código que não faz aquilo.
      */}

        {/*
        O RESUMO DA GERÊNCIA, no TOPO (31/08/2026).

        É por onde a reunião começa: o número pelo qual o N4 responde no N3,
        antes de qualquer detalhe. Depois vêm as áreas, e depois as causas —
        do geral para o particular, que é a leitura do quadro.

        Estava no rodapé por herança: nasceu como rodapé quando a tela era só
        a lista de áreas, e ficou lá enquanto tudo acima dele mudava de lugar.
        Ninguém abre uma reunião pelo fim da página.

        O rolo SOMA numerador e denominador; não é a média dos percentuais das
        áreas. Uma área de 4 vendedores não pode pesar igual a uma de 18.
      */}
        <div ref={ondeEstaOTopo} />
        {(vendas.data?.gerencia || vendedor.data?.gerencia) && (
          <ResumoDaGerencia
            vendas={vendas.data?.gerencia ?? null}
            vendedor={vendedor.data?.gerencia ?? null}
            serieVendas={serie.data?.vendas.gerencia ?? null}
            serieVendedor={serie.data?.vendedor.gerencia ?? null}
            areasFora={foraDaMeta}
            areasComMeta={comMeta}
            metaVendas={metaVendas}
            semana={semana}
            emCurso={periodoEmCurso(hoje, ano, mes, semana)}
            historico={historico}
            onHistorico={(qual) =>
              setHistorico((atual) => (atual === qual ? null : qual))
            }
          />
        )}

        {/*
        O QUE ACONTECEU vem PRIMEIRO (31/08/2026).

        É a ordem da reunião do GD, e agora ela cabe: o que aconteceu ontem →
        por quê → o que fazer hoje. Antes o bloco de causas ficava no topo
        porque a marcação estava espalhada por onze acordeões e o Pareto seria
        alcançado só depois de 2.600px de rolagem. Com as áreas reduzidas a
        três (§7.31, e as três piores desde §7.59), a lista ocupa uma tela e a
        ordem certa deixa de custar
        rolagem.

        Lê-se de cima para baixo: os números das áreas, depois a contagem das
        causas com o Pareto ao lado.
      */}
        {/*
        O SELETOR DE VARIÁVEL SUBIU JUNTO com a contagem (09/09/2026).

        Ele morava no cabeçalho de "Por que aconteceu", que é onde a grade
        estava. Com a grade dentro das áreas, o único controle que decide o que
        elas contam ficaria abaixo delas -- e mudar de variável exigiria rolar
        para baixo, clicar, e rolar de volta para ver o que mudou.

        Um só, e aqui: duplicá-lo nos dois blocos daria dois controles para uma
        decisão, e a pergunta "qual dos dois vale" não tem resposta na tela.
      */}
        {/*
        As DUAS classes: `n4-bloco-cabeca` é a linha (título à esquerda, seletor
        à direita) e `n4-titulo-lista` é o respiro até a primeira área, que já
        existia aqui. Sem ela o cabeçalho encosta no primeiro cartão -- era o
        que a regra de 10px resolvia antes de o seletor entrar nesta linha.
      */}
        <div className="n4-bloco-cabeca n4-titulo-lista">
          {/*
          CABEÇALHO COMUM — ele rola e sai da tela, como qualquer outro.

          Passei o dia tentando fixar esta linha, e o analista descartou as três
          versões: banda branca quadrada, banda com cantos arredondados e banda
          no cinza do fundo. *"Esse quadradão atrás tá muito esquisito"* --
          e a queixa não era da cor: uma linha fixa de 1288px é um retângulo
          opaco cortando os cartões que passam por baixo, em qualquer cor.

          A escolha dele, entre três opções: fixar SÓ O SELETOR. O título e a
          nota rolam e vão embora; o que fica na tela é uma peça estreita, e
          peça pequena não vira retângulo. Ver `.n4-seg-solto`.

          Título em 17px, o mesmo de "Por que aconteceu": os dois são cabeçalho
          de bloco. Os 15px valiam quando esta linha era moldura fixa.
        */}
          <div className="n4-titulo-lista-esq">
            <h2 className="n4-bloco-t">O que aconteceu</h2>
            <span className="n4-titulo-lista-nota">da pior para a melhor</span>
          </div>
          {/*
          O SELETOR MORA AQUI, ACIMA DAS GRADES QUE ELE GOVERNA.
          Terceira posição em dois dias, e as duas anteriores foram descartadas
          pelo mesmo motivo — o controle longe do gesto:

            faixa fixa    só fecha em UMA linha a 1320px, medido. Fixa e
                          quebrando, custaria duas linhas em toda rolagem; e
                          punha dois segmentos idênticos com escopos diferentes
                          (gerência troca a tela, variável troca uma dimensão)
            "Por que      encostado no somatório e no Pareto que ele muda, mas
             aconteceu"   ABAIXO das áreas onde se digita: *"fica confuso pra
                          pessoa ter que descer as áreas de venda pra mudar o
                          ponto de causa"*

          Aqui ele fica onde a PASSADA COMEÇA. Contar causas é uma passada por
          variável — Vendas tem ONZE pontos de causa cadastrados e Vendedor
          QUATRO (medido no banco, 10/09/2026), listas diferentes que ninguém
          preenche ao mesmo tempo. Escolher a lente é o primeiro gesto da
          passada, e o primeiro gesto pertence ao começo da lista, não ao fim.

          O RÓTULO responde a outra queixa — *"não tá intuitivo que esse filtro
          é para os pontos de causa"*: o seletor diz o verbo ("contando causas
          de"), e cada grade lá embaixo repete a variável no botão ("Pontos de
          causa · Performance Vendedor"). A ligação fica escrita nas duas pontas.
        */}
          {variaveis.length > 1 && (
            <div ref={setOSeletor}>
              <SeletorVariavel
                variaveis={variaveis}
                atual={variavelAtual}
                trocar={setVariavelDoQuadro}
              />
            </div>
          )}
        </div>

        {comDado.length === 0 && (
          <p className="n4-semana-vazia">
            Nenhuma área com dado nesta semana — a carga ainda não chegou até
            aqui.
          </p>
        )}

        <div className="space-y-3">
          {visiveis.map((a) => (
            <CartaoArea
              key={a.id}
              areaVendaId={a.id}
              vendedor={porArea.get(a.id)}
              vendas={vendasPorArea.get(a.id)}
              variaveis={variaveis}
              semana={semana}
              {...(atual && variavelAtual
                ? {
                    contagem: {
                      variavelId: variavelAtual,
                      variavel: nomeDoQuadro,
                      gerenciaId: atual,
                      ano,
                      mes,
                    },
                  }
                : {})}
              {...(faiscaVendedor.has(a.id)
                ? { faiscaVendedor: faiscaVendedor.get(a.id)! }
                : {})}
              {...(faiscaVendas.has(a.id)
                ? { faiscaVendas: faiscaVendas.get(a.id)! }
                : {})}
            />
          ))}
        </div>

        {/*
        O BOTÃO DIZ O QUE APARECE, E QUANTAS (10/09/2026).

        Era o par de duas palavras "Ver todas" / "Ver resumo". Curto, mas
        "todas" não dizia todas o QUÊ, e "resumo" prometia um bloco de resumo
        que não existe -- o que ele faz é recortar a lista de volta às três
        piores. Pedido do analista: *"deixe mais intuitivo que ao clicar
        expande todas as áreas de venda"*.

        Três coisas escritas, e nenhuma inventada: o objeto ("áreas de venda"),
        quantas entram ou saem, e a direção do gesto na seta. A contagem já
        esteve aqui e saiu em 09/09 por cobrar releitura a cada clique -- mas
        ela era do formato antigo, "Ver as outras 9 áreas", sem dizer o que era
        uma "área". Com o objeto escrito, o número deixa de ser enfeite e passa
        a ser a razão de clicar: quem lê "outras 9 áreas de venda" sabe o
        tamanho do que vai abrir ANTES de abrir, numa reunião cronometrada.

        `escondidas` é contado, não fixo: `QUANTAS_ABERTAS` é 3, mas a lista só
        tem as áreas COM DADO, e numa semana em que a carga alcançou cinco áreas
        o texto tem de dizer duas, não nove.
      */}
        {comDado.length > QUANTAS_ABERTAS &&
          (() => {
            const escondidas = comDado.length - QUANTAS_ABERTAS;
            return (
              <button
                type="button"
                className="n4-expandir"
                onClick={() => setVerTodas((v) => !v)}
              >
                <span aria-hidden>{verTodas ? "▴" : "▾"}</span>{" "}
                {verTodas
                  ? `Mostrar só as ${String(QUANTAS_ABERTAS)} piores áreas de venda`
                  : `Abrir as outras ${String(escondidas)} ${escondidas === 1 ? "área" : "áreas"} de venda`}
              </button>
            );
          })()}

        {/*
        POR QUE ACONTECEU — a contagem e o Pareto, DEPOIS das áreas.

        A posição do Pareto mudou quatro vezes, e cada mudança pagou o preço da
        anterior:

          embaixo de 11 áreas   2.600px de rolagem numa reunião de 15 minutos
          coluna à direita      espremia as ONZE áreas em metade da largura
          topo, largura cheia   resolvia os dois, ao custo de inverter a ordem
                                do GD
          DEPOIS de 3 áreas     ← aqui

        O que destravou foi reduzir a lista a três (§7.31; desde §7.59 são as três
        de pior desempenho, e não as do cadastro): a rolagem que
        empurrou o bloco para o topo deixou de existir, e a ordem da reunião
        volta a ser a ordem da tela.
      */}
        {atual && variaveis.length > 0 && (
          <section className="n4-bloco-causas">
            <div className="n4-bloco-cabeca">
              {/*
              AQUI NÃO HÁ CONTROLE — há a DECLARAÇÃO de qual variável está na
              tela. Este bloco é consequência: a matriz soma o que as áreas
              contaram e o Pareto ordena. Quem chega aqui está lendo, não
              escolhendo, e o que ele precisa saber é "isto é de qual".

              Foi o que resolveu a segunda queixa do analista -- *"ele se perde
              quando vai ver lá embaixo no Pareto"*. O seletor não precisa vir
              até aqui: o nome vem, no título. Um controle repetido daria duas
              peças para uma decisão, e "qual das duas vale" não tem resposta na
              tela. A volta é o botão do fim da seção, que troca E sobe.
            */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <h2 className="n4-bloco-t">
                  Por que aconteceu{" "}
                  <span className="n4-bloco-t-var">{nomeDoQuadro}</span>
                </h2>
                <p className="n4-bloco-s">
                  O somatório{g?.nome ? ` da ${g.nome}` : ""} e, ao lado, por
                  onde começar
                </p>
              </div>
            </div>

            {/*
            SOMAR e PRIORIZAR, lado a lado.

            À esquerda o total das áreas, à direita por onde começar -- as duas
            leituras do mesmo número, uma ao lado da outra. É gestão à vista: a
            matriz diz quanto, o Pareto diz qual primeiro.

            Nenhuma das duas se digita. O que se digita é a grade da área, lá em
            cima; aqui é a consequência. Foi o inverso entre 31/08 e 09/09, e é
            por isso que o rótulo mudou de "Contagem da semana" para
            "Somatório da gerência" -- a caixa é a mesma, o gesto não.

            Abaixo de 1100px empilha.
          */}
            {variavelAtual && (
              <div className="n4-duo">
                <Grade
                  variavelId={variavelAtual}
                  variavel={null}
                  gerenciaId={atual}
                  ano={ano}
                  mes={mes}
                  semana={semana}
                />
                <Pareto
                  variavelId={variavelAtual}
                  gerenciaId={atual}
                  gerenciaNome={g?.nome ?? ""}
                  ano={ano}
                  mes={mes}
                  filial={pedido?.filial ?? usuario?.filial ?? ""}
                  contexto={`${nomeDoQuadro} · ${g?.nome ?? ""}`}
                />
              </div>
            )}
          </section>
        )}

        {/*
        O QUE JÁ ESTÁ SENDO FEITO — o terceiro tempo da reunião.

        Depois de "por que aconteceu", e é a ordem do GD: o que aconteceu, por
        quê, e o que está sendo feito. Vem DEPOIS do Pareto de propósito -- quem
        acabou de ver por onde começar precisa saber se já existe ação para
        aquilo antes de abrir a segunda.

        SÓ PARA QUEM OLHA DE CIMA — N3 e N2 (ver `olhandoDeCima`). O quadro de
        Ações do N4 já é a lista completa das ações dele; quem vem de cima é que
        passa por várias gerências e precisa ver o que está em pé em cada uma.
      */}
        {atual && olhandoDeCima && <AcoesDaGerenciaN4 gerenciaId={atual} />}

        {/*
        O HISTÓRICO NO FIM, atrás do "Ver histórico" de cada cartão de cima.

        Ele já esteve entre "o que aconteceu" e "por que aconteceu", pela ordem
        da conversa: os números da semana, como se chegou neles, e só então as
        causas. Isso valia enquanto ele abria sozinho -- ali, no caminho, ele
        era lido na sequência.

        Atrás de um clique a ordem deixa de ser a da leitura e passa a ser a de
        quem escolheu ver: a reunião corre inteira, e o histórico entra depois,
        quando alguém pergunta se o vermelho de hoje é exceção ou tendência.
        Aberto no meio, ele empurraria "por que aconteceu" para fora da tela --
        o bloco onde se digita -- para responder uma pergunta lateral.

        Abre UM gráfico: o do cartão de onde se clicou.

        A `<div>` com o `ref` fica SEMPRE renderada, mesmo fechada: é o alvo do
        `scrollIntoView`, e uma referência que só existe depois de aberto
        chegaria vazia no instante em que é usada.
      */}
        <div ref={ondeEstaOHistorico}>
          {historico !== null && atual && g && (
            <HistoricoMensal
              selo={nomeLegivel(g.nome)}
              chave={`gerencia:${g.id}:${visao.toString()}`}
              carregar={(meses) =>
                variaveisApi.historicoMensal(g.id, { meses, visao })
              }
              graficos={[historico]}
              sobDemanda
            />
          )}
          {/*
          FECHA E SOBE -- o par do "Ver histórico" do cartão.

          `.n4-expandir` reaproveitado do "Ver todas": mesmo registro (ação
          discreta, largura cheia, no fim de uma lista), e inventar uma classe
          nova daria dois desenhos para o mesmo tipo de botão.

          Fecha ANTES de subir. Deixar aberto faria o link do cartão dizer
          "Ocultar histórico" apontando para um gráfico que ficou fora da vista.
        */}
          {historico !== null && (
            <button
              type="button"
              className="n4-expandir"
              onClick={() => {
                setHistorico(null);
                ondeEstaOTopo.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
            >
              <span aria-hidden>↑</span> Fechar histórico e voltar ao topo
            </button>
          )}
        </div>
      </div>

      {/*
        A PEÇA SOLTA, alinhada com a coluna de conteúdo, logo abaixo da faixa da
        gerência. Só existe enquanto o seletor do cabeçalho está fora da tela.

        Caixa branca com borda e sombra AQUI tem função: ela flutua sobre os
        cartões, e sem elevação pareceria pertencer ao cartão que passa atrás.
        Era o oposto do caso da linha inteira, onde a caixa não resolvia nada e
        só somava um retângulo na tela.

        A classe `n4` não é enfeite: as cores deste arquivo são variáveis
        declaradas em `.n4`, e a peça fica fora daquele container.
      */}
      {variaveis.length > 1 && !seletorNaTela && (
        <div className="n4 n4-seg-solto">
          <SeletorVariavel
            variaveis={variaveis}
            atual={variavelAtual}
            trocar={setVariavelDoQuadro}
          />
        </div>
      )}
    </>
  );
}
