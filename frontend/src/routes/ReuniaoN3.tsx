import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import './reuniao-n3.css'
import { Faisca } from '../components/Faisca.js'
import { HistoricoMensal } from '../components/HistoricoMensal.js'
import { BlocoDeAcoes } from '../components/acoes/BlocoDeAcoes.js'
import { useSessao } from '../contexts/SessaoContext.js'
import { useGdsDaTela } from '../contexts/GdsDaTelaContext.js'
import { MESES, usePeriodo } from '../contexts/PeriodoContext.js'
import { useVisao } from '../contexts/VisaoContext.js'
import { mensagemDeErro, variaveisApi } from '../lib/api.js'
import { gdEscolhido } from '../lib/gd-escolhido.js'
import type { Gerencia, ResumoAcao } from '../lib/api.js'
import {
  periodoEmCurso,
  semanaAtual,
  useAcoesDaLoja,
  useGerencias,
} from '../hooks/useReuniaoN4.js'
import { ALVO_PERFORMANCE, dinheiro, legendaDaMeta, percentualComSinal } from '../lib/formato.js'
import { areas, coresDaGerencia, nomeLegivel } from '../lib/nomes.js'
import { quantoFalta, useQuadroN3, type NumerosDaGerencia } from '../hooks/useQuadroN3.js'

/**
 * A reunião do N3 — o gerente geral de loja.
 *
 * **É outra tela do N4, não a mesma com outro filtro.** Lá o acordeão é por
 * ÁREA DE VENDA dentro de uma gerência; aqui é por GERÊNCIA, agrupada por
 * indicador, com o total da loja no rodapé. Ver `docs/demo-n3.html` — a
 * estrutura vem dele, não do que era conveniente reaproveitar.
 *
 * O CARTÃO DE GERÊNCIA É UM LINK, e não um acordeão (09/09/2026).
 *
 * Ele abria três blocos aqui dentro -- o desdobramento por área de venda, o
 * Pareto em leitura e as ações com a trilha. Os três EXISTEM NO N4, e lá são
 * acionáveis: o Pareto se marca, a ação se abre, a área tem supervisor com
 * nome. Aqui eram cópias somente-leitura da mesma informação, mantidas em
 * paralelo -- e duas telas desenhando o mesmo dado é como elas passam a
 * discordar.
 *
 * Clicar em "Construção" abre o N4 de Construção daquela filial. O N3 fica com
 * o que é dele: o consolidado da loja, a lista ordenada por gravidade, e o
 * histórico. É uma tela de TRIAGEM -- ela diz por onde começar, e o começar
 * acontece no quadro da gerência.
 */


const SEMANAS = [1, 2, 3, 4, 5]


/**
 * Na meta, fora, ou não dá para dizer.
 *
 * `null` não é "fora": é ausência de comparação — sem meta cadastrada ou sem
 * número. Pintar de vermelho o que não se sabe é o mesmo defeito de mostrar
 * zero onde falta carga.
 */
function naMeta(percentual: number | null, meta: number | null): boolean | null {
  if (percentual === null || meta === null) return null
  return percentual >= meta
}

/**
 * A TINTA do farol, a partir de `naMeta`. Verde na meta, vermelho fora, cinza
 * quando não há com o que comparar.
 *
 * Este ternário estava escrito em DOIS lugares desta tela -- no `Kpi` e na
 * tabela do desdobramento -- e a terceira cópia ia nascer agora, no valor de
 * vendas da composição. De duas cópias é sempre a segunda que fica para trás,
 * e o jeito de essa ficar para trás é o pior possível: `null` cair no verde,
 * pintando de "está bom" o que ninguém mediu.
 *
 * Devolve `var(--...)`, e não classe: os três usos põem a cor em `style`, um
 * deles num `<td>` de tabela.
 */
function tintaDoFarol(ok: boolean | null): string {
  if (ok === null) return 'var(--off)'
  return ok ? 'var(--ok-texto)' : 'var(--cri-texto)'
}

/**
 * A TARJA ESQUERDA do cartão: verde na meta, vermelha fora, cinza sem meta.
 *
 * É FAROL, e não identidade. Foi a cor da gerência por um dia -- navy para
 * Construção, azul para Não Construção --, e nessa versão o cartão fora da meta
 * ficava indistinguível do cartão em dia até alguem ler o percentual. Numa
 * lista ordenada por gravidade, a primeira coisa que a borda pode dizer é se
 * há problema.
 *
 * A identidade da gerência continua na tela, no marcador redondo antes do nome
 * (`.n3-ponto-ger`): duas informações, dois elementos. Antes as duas dividiam a
 * borda e uma tinha de vencer a outra.
 *
 * Usa as cores de PONTO (`--ok-ponto`, `--cri-ponto`) e não as de texto: é uma
 * faixa de 4px vista de longe, e as de texto são escuras de propósito para
 * contraste sobre fundo claro.
 *
 * `--off` sem meta: sem com o que comparar não há farol. Verde ali afirmaria
 * "está bom" sobre o que ninguém mediu -- o mesmo defeito de §7.37.
 */
function tarjaDoFarol(ok: boolean | null): string {
  if (ok === null) return 'var(--off)'
  return ok ? 'var(--ok-ponto)' : 'var(--cri-ponto)'
}

/**
 * "VENDAS x │ META y" — a composição do KPI de vendas.
 *
 * A MESMA frase em dois escopos: o cartão do topo (a loja) e o de cada
 * gerência. Estava escrita inline nos dois, e o N4 tem a terceira — escrever
 * de novo era garantir que uma delas ficasse para trás.
 *
 * O farol vai SÓ no valor realizado. A meta é a RÉGUA: não está boa nem ruim,
 * e pintar as duas poria duas afirmações de estado numa linha que tem uma.
 *
 * O separador é um ELEMENTO de 1px, e não o caractere "|": o glifo herda peso
 * e cor do texto, e numa linha com rótulo pequeno e valor em negrito ele sai
 * mais forte que os rótulos que deveria apenas separar.
 */
function ComposicaoVendas({
  realizado,
  meta,
  ok,
}: {
  realizado: number
  meta: number
  /** `null` = sem com o que comparar; o valor sai cinza. Ver `tintaDoFarol`. */
  ok: boolean | null
}) {
  return (
    <>
      <span className="n3-comp-rot">Vendas</span>{' '}
      <span style={{ color: tintaDoFarol(ok) }}>{dinheiro(realizado)}</span>
      <span className="n3-comp-sep" aria-hidden />
      <span className="n3-comp-rot">Meta</span> {dinheiro(meta)}
    </>
  )
}

/**
 * Qual variável é qual, pelo NOME.
 *
 * O portal tem duas rotas de performance — Vendas e Vendedor — e a variável de
 * controle é cadastro, com nome livre. O casamento por nome é o mesmo que a
 * tela do N4 já faz; ele quebra em silêncio se alguém renomear a variável no
 * cadastro, e o sintoma é o KPI sumir. Registrado como dívida.
 */
const ehVendedor = (nome: string) => nome.toLowerCase().includes('vendedor')

export function ReuniaoN3() {
  const { usuario } = useSessao()
  const { params: visao, chave, pedido, definir } = useVisao()
  const hoje = new Date()

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
  const { periodo } = usePeriodo()
  const ano = periodo.ano
  const mes = periodo.modo === 'mes' ? periodo.mes : hoje.getMonth() + 1
  const [semana, setSemana] = useState(semanaAtual(hoje))

  /*
    A MEDIÇÃO DA FAIXA DE IDENTIDADE SAIU com a faixa (12/09/2026).

    `--altura-faixa-identidade` alimentava o `top` do aviso de visão, que
    grudava embaixo dela. Sem faixa, a variável não é publicada e o `calc` do
    aviso cai no fallback de 0px -- que agora é o valor CERTO, e não um
    acidente: o aviso passa a grudar direto no cabeçalho.
  */

  const gerencias = useGerencias({ visao, chave, ano, mes })
  const lista = gerencias.data?.gerencias ?? []

  /**
   * DESCER PARA O N4 mantém a visão simulada em dia.
   *
   * **O defeito** (relatado em 10/09/2026): o N2 clica numa célula da matriz e
   * recebe a visão `N3 · NOR` (§7.63); depois clica no cartão de Construção e
   * cai no N4 — mas o chip do cabeçalho continua dizendo `N3 · NOR`. Palavra do
   * analista: *"deveria tá N4 · NOR · CONS"*. O chip descrevia onde a pessoa
   * ESTEVE, não onde está, e ele existe justamente para ser o aviso de que a
   * tela não é a sua.
   *
   * **Só ajusta quem JÁ está simulando** (`pedido !== null`), e é o ponto da
   * função. Um N3 de verdade abrindo a gerência da própria loja está na visão
   * natural dele: criar um pedido ali acenderia a faixa laranja de "você não
   * está na sua visão" sobre a tela mais dele que existe.
   *
   * A filial vem do PEDIDO, e não do usuário: quem simula pode não ter filial
   * nenhuma no cadastro — é o caso do N2, que é corporativo. Ler `usuario`
   * aqui gravaria `filial: null` num nível que exige filial, e o servidor
   * recusaria a visão inteira.
   *
   * A gerência vai por NOME porque `PedidoVisao` é assim: o id é por (filial,
   * gerência), e guardá-lo faria a escolha apontar para a linha de outra loja
   * ao trocar de filial. Ver o comentário do tipo.
   */
  const entrarNaGerencia = (nomeDaGerencia: string) => {
    if (pedido === null) return
    definir({ nivel: 'N4', filial: pedido.filial, gerencia: nomeDaGerencia })
  }

  /*
   * As gerências agrupadas por INDICADOR — é a categoria do quadro.
   *
   * A ordem vem da resposta, que já ordena as variáveis por `ordem`; agrupar
   * aqui preserva a primeira aparição de cada indicador. Categoria sem
   * variável não existe na resposta, então não há o que esconder: o quadro
   * mostra o que se acompanha, não o que se pretende acompanhar (§7.11).
   */
  const porIndicador = new Map<string, { nome: string; gerencias: Gerencia[] }>()
  for (const g of lista) {
    for (const c of g.categorias) {
      const grupo = porIndicador.get(c.indicador) ?? { nome: c.nome, gerencias: [] }
      grupo.gerencias.push(g)
      porIndicador.set(c.indicador, grupo)
    }
  }

  /*
   * QUAL GD a tela está mostrando.
   *
   * O portal terá um GD por domínio -- Vendas, NPS, Logística Interna,
   * Perdas --, cada um com as próprias variáveis de controle e os próprios
   * perfis. HOJE só o de Vendas tem variáveis cadastradas, e a tela não dizia
   * isso em lugar nenhum: quem abria via "Reunião diária" e não tinha como
   * saber de que reunião se tratava.
   *
   * A lista sai do DADO (`porIndicador`), e não de uma constante: GD sem
   * variável não aparece, porque não há reunião para ele. Quando os outros
   * forem cadastrados, as abas surgem sozinhas.
   */
  const gds = [...porIndicador].map(([codigo, g]) => ({ codigo, nome: g.nome }))

  /*
   * O GD ESCOLHIDO VIVE NA URL, e não em `useState` (10/09/2026, §7.63).
   *
   * A matriz do N2 passou a abrir esta tela já no GD da célula clicada -- NPS
   * da CEN abre o GD de NPS. Com o estado local, o link só conseguia abrir a
   * tela; qual aba mostrar era decisão interna dela, e a primeira sempre
   * ganhava.
   *
   * `replace: true` ao trocar de aba: a reunião não é uma sequência de páginas,
   * e sem isso o "voltar" do navegador andaria uma aba por vez até sair da
   * tela -- é a mesma escolha do seletor de gerência do N4.
   *
   * O código na URL é CONFERIDO contra `gds` (que sai do dado), e não usado
   * direto: `?gd=xpto` cairia no primeiro GD em vez de mostrar aba nenhuma.
   */
  const [busca, setBusca] = useSearchParams()
  const gdPedido = busca.get('gd')
  /*
   * GD PEDIDO E INEXISTENTE NÃO CAI NO PRIMEIRO.
   *
   * O `?? gds[0]` valia quando ninguém pedia nada: abrir a tela sem escolha
   * mostra o primeiro GD, e está certo. Com a matriz do N2 mandando o código da
   * célula, o mesmo `??` viraria uma troca silenciosa -- clicar em NPS abriria a
   * reunião de VENDAS com a aba de Vendas marcada, e nada na tela diria que o
   * pedido foi outro. O analista confirmou o caso: o GD de NPS *"não existe
   * ainda"*.
   *
   * Então: sem pedido, o primeiro; com pedido que existe, ele; com pedido que
   * não existe, NENHUM -- e um aviso abaixo da barra.
   */
  const gdAtivo = gdEscolhido(gds, gdPedido)
  /*
   * `gds.length > 0` no aviso, e é o ponto: sem ele a frase "este GD não tem
   * reunião cadastrada" aparecia para VENDAS.
   *
   * Com a lista de gerências vazia -- loja sem gerência, ou a requisição
   * falhando -- `gds` também fica vazia, e `gdAtivo` cai em `null` por um
   * motivo que não é o do aviso. Visto na tela: sessão caída devolvendo 401, e
   * a tela acusando o cadastro do GD de Vendas, que existe.
   *
   * São duas ausências diferentes, e a tela já diz a outra logo abaixo
   * ("nenhuma gerência nesta loja"). Este aviso só vale quando HÁ GDs para
   * escolher e o pedido não é nenhum deles.
   */
  const gdPedidoNaoExiste = gdPedido !== null && gdAtivo === null && gds.length > 0
  const setGd = useCallback(
    (codigo: string) => {
      setBusca({ gd: codigo }, { replace: true })
    },
    [setBusca],
  )

  /*
    PUBLICA OS GDs para o cabeçalho desenhar — ver `GdsDaTelaContext`.

    E LIMPA AO SAIR, que é a metade fácil de esquecer: sem o `return`, as abas
    desta reunião continuariam no cabeçalho depois de navegar para Ações, sobre
    uma tela que não tem GD nenhum.
  */
  const { publicar } = useGdsDaTela()

  /**
   * A LISTA MEMOIZADA PELO CONTEÚDO — e isto não é otimização, é correção.
   *
   * `gds` é derivado com `.map` a cada render, então é um array NOVO sempre.
   * Com ele na lista de dependências, o efeito abaixo re-executa a cada
   * render -- e a limpeza dele roda junto, publicando `null` antes de publicar
   * de novo. O estado do contexto passa a alternar `null` → lista → `null`, e
   * cada troca re-renderiza a árvore: **`Maximum update depth exceeded`**.
   *
   * Aconteceu em 12/09/2026, e o sintoma na tela não apontava para cá: o
   * cabeçalho CONGELAVA ao sair da reunião -- rota trocava, título não. O laço
   * travava o render antes de o novo título chegar.
   *
   * A chave é o conteúdo (`codigo:nome`, em ordem). Mudou de verdade, remonta;
   * é o mesmo, o array sobrevive e o efeito não roda.
   */
  const chaveDosGds = gds.map((g) => `${g.codigo}:${g.nome}`).join('|')
  const listaDeGds = useMemo(
    () => gds.map((g) => ({ codigo: g.codigo, nome: g.nome })),
    //  Por CONTEÚDO e não por identidade -- ver acima. (A regra
    //  `exhaustive-deps` não está ligada neste projeto; se um dia estiver, ela
    //  vai reclamar de `gds` aqui, e a resposta é este comentário.)
    [chaveDosGds],
  )
  const codigoAtivo = gdAtivo?.codigo ?? null

  /*
    PUBLICA OS GDs para o cabeçalho desenhar — ver `GdsDaTelaContext`.

    E LIMPA AO SAIR, que é a metade fácil de esquecer: sem o `return`, as abas
    desta reunião continuariam no cabeçalho depois de navegar para Ações, sobre
    uma tela que não tem GD nenhum.

    Todas as dependências são estáveis de propósito: `listaDeGds` é memoizada
    pelo conteúdo, `codigoAtivo` é string, `setGd` é `useCallback`. É isso que
    faz a limpeza rodar só ao desmontar.
  */
  useEffect(() => {
    publicar({ lista: listaDeGds, ativo: codigoAtivo, trocar: setGd })
    return () => {
      publicar(null)
    }
  }, [publicar, listaDeGds, codigoAtivo, setGd])

  const semanaLimite =
    ano === hoje.getFullYear() && mes === hoje.getMonth() + 1 ? semanaAtual(hoje) : 5

  const filial = pedido?.filial ?? usuario?.filial ?? '—'
  /*
   * QUEM EU SOU, e não o que estou olhando — a exceção à regra do nível
   * efetivo.
   *
   * As quatro correções de 10/09/2026 (`lib/quadro-do-nivel.ts`) mandam ler o
   * nível EFETIVO — `pedido?.nivel ?? usuario?.nivel`. Aquelas perguntas eram
   * sobre QUAL QUADRO abrir, e aí quem manda é a visão.
   *
   * Esta é outra pergunta: "eu estou ACIMA da reunião que está na tela?". Quem
   * responde é o cadastro. Escrita com o efetivo, o N2 que simula `N3 · CEN`
   * vira N3 e o bloco sumia justamente no caso para o qual ele existe — foi
   * assim que esta linha nasceu errada, e a tela mostrou.
   *
   * Um N3 de verdade continua sem o bloco: a lista completa dele está na tela
   * de Ações, e repeti-la dentro da própria reunião daria duas listas para uma
   * pergunta.
   */
  const olhandoDeCima = usuario?.nivel === 'N2'
  /*
   * A filial SEM o fallback de traço.
   *
   * `filial` cai em "—" quando o N2 corporativo abre esta tela sem escolher a
   * loja na visão -- e aí a própria tela avisa para escolher. Buscar as ações
   * com "—" pediria o quadro de uma loja que não existe, e o bloco respondia
   * "nenhuma ação aberta": uma frase sobre a reunião, quando o que houve foi
   * falta de recorte.
   */
  const filialDoQuadro = pedido?.filial ?? usuario?.filial ?? null

  /*
   * Qual categoria a gerência usa. Era o agrupamento por indicador que dizia
   * isto; com a lista ordenada por gravidade, cada gerência carrega o seu.
   * Hoje é sempre `vendas` — a única categoria com variáveis cadastradas.
   */
  const indicadorDe = (g: Gerencia) => g.categorias[0]?.indicador ?? 'vendas'

  /**
   * Os números de TODAS as gerências, aqui em cima — ver `useQuadroN3`.
   *
   * É o que permite o consolidado da loja, a ordem *piores primeiro* e a
   * contagem de áreas fora da meta: nenhuma das três é calculável por um cartão
   * que só conhece a si mesmo.
   */
  const numeros = useQuadroN3(lista, ano, mes, semana)

  /**
   * O CONSOLIDADO da loja: soma numerador e denominador, nunca a média dos
   * percentuais.
   *
   * Uma gerência de 8 áreas não pode pesar igual a uma de 13 — é a mesma regra
   * que o rolo da gerência já segue sobre as áreas dela.
   */
  const somaVendas = numeros.reduce(
    (a, n) => ({
      numerador: a.numerador + (n.vendas?.numerador ?? 0),
      denominador: a.denominador + (n.vendas?.denominador ?? 0),
    }),
    { numerador: 0, denominador: 0 },
  )
  const somaVendedor = numeros.reduce(
    (a, n) => ({
      numerador: a.numerador + (n.vendedor?.numerador ?? 0),
      denominador: a.denominador + (n.vendedor?.denominador ?? 0),
    }),
    { numerador: 0, denominador: 0 },
  )
  /*
   * COM SINAL para o cartão consolidado — negativa quando a projeção passa da
   * meta. O `quantoFalta` corta em zero, e é o certo para ORDENAR (pior
   * primeiro) e para a linha de gerência, que esconde o valor quando bate.
   * No cartão o zero ia para o maior número da tela: "R$ 0 mil" ocupando o
   * slot mais visível para anunciar uma ausência.
   */
  const diferencaNaLoja =
    somaVendas.denominador > 0 ? somaVendas.denominador - somaVendas.numerador : null

  /*
   * As áreas de TODAS as gerências, para os dois chips. Só entram as que têm
   * meta -- área sem denominador não está nem dentro nem fora dela.
   */
  const areasComMeta = numeros.flatMap((n) =>
    n.areasVendas.filter((a) => a.denominador !== null && a.denominador > 0),
  )
  const areasFora = areasComMeta.filter((a) => (a.percentual ?? 0) < 100).length

  /**
   * PIORES PRIMEIRO — o olho começa onde dói.
   *
   * Ordena por quanto FALTA em R$, e não pelo percentual: 92% de uma gerência
   * grande pode ser um buraco maior que 88% de uma pequena, e é o buraco que a
   * reunião tem de atacar primeiro. Sem meta vai para o fim — não dá para dizer
   * que está mal quem ninguém comparou.
   */
  const ordenadas = [...numeros].sort((a, b) => {
    const fa = quantoFalta(a.vendas)
    const fb = quantoFalta(b.vendas)
    if (fa === null) return fb === null ? 0 : 1
    if (fb === null) return -1
    return fb - fa
  })

  return (
    <>
      {/*
        A BARRA DE GDs -- de qual Gerenciamento Diário é esta reunião.

        Fica acima do cabeçalho porque troca a tela inteira, e não um filtro
        dentro dela. Com um GD só ela ainda vale: é ela que responde "Vendas" à
        pergunta que o título sozinho deixava no ar.

        VIROU FAIXA FIXA em 10/09/2026, como a da gerência no N4 -- mesmo pedido
        do analista, mesma solução. Para isso ela SAIU do container de conteúdo
        e virou filha direta do `main`, com `-mx-gutter` sangrando de ponta a
        ponta: dentro do container ela ficaria com o fundo cinza da página
        aparecendo dos lados, e o conteúdo rolando por ali.

        Ela carrega a classe `.n3` junto porque é quem define as variáveis de
        cor (`--ter`, `--borda`, ...). Fora dela, a barra perderia a paleta em
        silêncio -- o mesmo motivo pelo qual a faixa do N4 leva `.n4`.

        E ganhou o RECORTE à direita ("N3 · NOR · Gerência Geral"), porque é o
        que sobra na tela depois que o título grande rola para fora.
      */}
      {/*
        A FAIXA FIXA DE GDs SAIU DAQUI EM 12/09/2026.
        
        Ela era uma barra inteira, `sticky` embaixo do cabeçalho, só para
        escolher entre Vendas, NPS, Perdas e Custo -- e a escolha é global: diz
        em qual quadro você está. No desenho que o analista trouxe, ela subiu
        para a barra branca do cabeçalho, ao lado de "Gerenciamento diário de".
        
        A tela agora PUBLICA a lista e o cabeçalho a desenha (ver
        `GdsDaTelaContext`). Some junto a terceira faixa fixa da tela: sobraram
        o cabeçalho e o aviso de visão.
      */}

      <div className="n3 mx-auto max-w-[1320px] px-4 py-6">

      {/*
        O GD PEDIDO NÃO EXISTE — diz, em vez de abrir outro.

        Acontece hoje: a matriz do N2 manda o código da célula clicada, e só o
        GD de Vendas tem variável de controle cadastrada. O aviso é o que separa
        "não existe reunião para isto" de "a tela ignorou seu clique".

        Some sozinho no dia em que o GD for cadastrado: a lista `gds` sai do
        dado, e a aba aparece sem ninguém mexer aqui.
      */}
      {gdPedidoNaoExiste && (
        <p className="n3-gd-vazio">
          Este Gerenciamento Diário ainda não tem reunião cadastrada — nenhuma gerência acompanha
          variável de controle dele. Escolha um dos GDs acima.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1 }}>
          {/*
            O NÍVEL PRIMEIRO -- "N3 · NOR · Gerência Geral" (10/09/2026).

            Mesma ordem da faixa do N4 ("N4 · Vendas · NOR") e do olho do N2,
            para as três telas se apresentarem igual. Antes começava pela filial,
            e a tela não dizia em que nível da cadeia se estava.

            "N3" cravado: esta tela É o quadro do N3. Ler o nível efetivo aqui
            descreveria quem OLHA -- um N2 simulando veria "N2" sobre a reunião
            do gerente geral.
          */}
          {/*
            SEM O RECORTE E SEM "REUNIÃO DIÁRIA" — os dois subiram para o
            cabeçalho global na direção B (12/09/2026).
            
            Aqui dizia `N3 · CEN · GERÊNCIA GERAL` sobre `Vendas Reunião
            diária`, e as duas linhas passaram a repetir o canto esquerdo do
            cabeçalho, que está a três centímetros acima e não rola.
            
            O `h1` fica, e fica com o GD: ele é o TÍTULO DO DOCUMENTO, e as abas
            da faixa são navegação -- coisas diferentes, mesmo dizendo a mesma
            palavra. Uma tela sem `h1` perde a âncora de leitura e a de leitor
            de tela.
          */}
          {/*
            A IDENTIDADE VOLTOU PARA CÁ, com o selo do nível (12/09/2026).

            Ela morava na faixa fixa, que subiu para o cabeçalho como abas de
            GD. O desenho do analista devolve o recorte ao topo da PÁGINA --
            onde ele não compete com nada e rola junto com o conteúdo, que é o
            comportamento certo para um dado que se lê uma vez ao chegar.

            "N3" num selo em vez de texto corrido: é o degrau da cadeia, e o
            olho o procura. Cravado, não efetivo -- esta tela É o quadro do N3,
            e ler o nível de quem olha faria um N2 simulando ver "N2" sobre a
            reunião do gerente geral.
          */}
          <div className="n3-recorte">
            <span className="n3-selo-nivel">N3</span>
            <span>Gerência geral · {filial}</span>
          </div>
          <h1>
            {gdAtivo?.nome ?? ''} <span className="n3-h1-sub">Reunião diária</span>
          </h1>
          <span className="n3-sub">
            {MESES[mes - 1]} de {ano}
            {lista.length > 0 && ` · ${lista.length} gerência${lista.length > 1 ? 's' : ''}`}
          </span>
        </div>


        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="n3-eyebrow">Semana</span>
          <div className="n3-semanas">
            {SEMANAS.map((s) => {
              const futura = s > semanaLimite
              return (
                <button
                  key={s}
                  type="button"
                  className={`n3-sem ${s === semana ? 'on' : ''} ${futura ? 'futura' : ''}`}
                  onClick={futura ? undefined : () => setSemana(s)}
                  disabled={futura}
                  title={futura ? 'Semana que ainda não aconteceu' : undefined}
                >
                  S{s}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/*
        O CABEÇALHO DE TRÊS CARTÕES — o protótipo de 31/08 (§7.38).

        O primeiro é o número que a reunião persegue: QUANTO FALTA em R$ para a
        meta da semana. Ele não existia em lugar nenhum da tela anterior, que só
        sabia dizer percentuais — e "faltam R$ 1,36 mi" diz o tamanho do
        problema de um jeito que "97%" não diz.

        Os outros dois são os indicadores, com a barra contra o alvo e o quanto
        andaram desde a semana passada. O delta é o que transforma um número
        num movimento: 97% parado e 97% subindo pedem conversas diferentes.
      */}
      {lista.length > 0 && (
        <CabecalhoDaLoja
          diferenca={diferencaNaLoja}
          vendas={somaVendas}
          vendedor={somaVendedor}
          areasFora={areasFora}
          areasComMeta={areasComMeta.length}
          numeros={numeros}
          semana={semana}
          emCurso={periodoEmCurso(hoje, ano, mes, semana)}
        />
      )}

      {/*
        ERRO E LISTA VAZIA SÃO COISAS DIFERENTES, e a mensagem antiga jurava
        que a segunda era a única possível: *"é cadastro, não erro"*.

        Visto na tela (10/09/2026): um N2 com a visão natural abre esta tela, o
        servidor responde **422** -- "N2 é corporativo e não tem filial própria"
        --, e a tela dizia "nenhuma gerência nesta loja" sobre nove lojas. A
        frase que existia para tranquilizar passou a esconder a causa.

        Acontece pelo caminho normal: "Voltar à minha visão" enquanto se olha o
        N3 de uma loja. A `FaixaVisao` agora leva para o quadro do nível, mas a
        tela tem de saber se explicar de qualquer forma -- basta uma URL
        guardada nos favoritos.

        AS TRÊS CONDIÇÕES SÃO EXCLUSIVAS DE PROPÓSITO, e a do vazio é
        `isSuccess`, não "nem carregando nem erro".

        A primeira tentativa disto usava `!isLoading && !error`, e deixava uma
        brecha medida na tela: o React Query REPETE a requisição que falhou, e
        durante as repetições `error` ainda é `undefined` enquanto `isLoading`
        já é `false`. A frase falsa voltava a aparecer, agora só por um
        instante -- que é pior, porque não se reproduz olhando.

        `isSuccess` afirma o que a frase precisa: o dado CHEGOU, e veio vazio.
      */}
      {gerencias.isFetching && !gerencias.data && <p className="n3-sub">Carregando…</p>}
      {gerencias.error && (
        <p className="n3-gd-vazio">{mensagemDeErro(gerencias.error, 'abrir a reunião desta loja')}</p>
      )}
      {gerencias.isSuccess && lista.length === 0 && (
        <p className="n3-sub">
          Nenhuma gerência nesta loja. É cadastro, não erro — fale com a administração.
        </p>
      )}

      {/*
        A LISTA, PIORES PRIMEIRO.

        O agrupamento por indicador saiu: com uma categoria só (Vendas) ele era
        um cabeçalho para uma seção única, e o que a reunião precisa no lugar
        dele é a ORDEM. A ordenação está em `ordenadas`, por quanto falta em R$.

        SAIU o "Recolher/Expandir todas". Ele existia porque a leitura tinha
        dois modos -- passar o olho pelas gerências e conferir área por área --
        e o segundo modo mudou de lugar: agora é o quadro do N4.
      */}
      {lista.length > 0 && (
        <div className="n3-lista-cabeca">
          <span className="n3-ind-nome">Vendas por gerência</span>
          <span className="n3-lista-dica">
            Piores primeiro · clique para abrir o quadro da gerência
          </span>
        </div>
      )}

      {lista.length > 0 && (
        <div className="n3-colunas">
          <span>Gerência</span>
          <span>Vendas na meta</span>
          <span>Vendedores na meta</span>
          <span className="dir">Tendência</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {ordenadas.map((n) => (
          <CartaoGerencia
            key={n.gerencia.id}
            numeros={n}
            indicador={indicadorDe(n.gerencia)}
            semana={semana}
            aoEntrar={entrarNaGerencia}
          />
        ))}
      </div>

      {/*
        COMO VIEMOS ATÉ AQUI, no escopo da LOJA.

        O MESMO componente do N4, com outro escopo -- as áreas de todas as
        gerências somadas. O N4 apresenta o gráfico dele nesta reunião, e duas
        formas para o mesmo número obrigariam a reaprender a leitura no meio da
        cadeia de ajuda. É a mesma razão pela qual o cabeçalho das duas telas
        tem o mesmo desenho.
      */}
      {lista.length > 0 && (
        <div style={{ marginTop: 20 }}>
          {/*
            SÓ PERFORMANCE VENDAS aqui -- decisão do analista, 08/09/2026.

            O N4 mostra os dois. Nesta tela o histórico de Vendedor seria por
            LOJA, e a reunião do gerente geral não pergunta isso: o número de
            vendedores na meta ela já tem no topo e no cartão de cada gerência,
            onde dá para agir. Doze meses do agregado da loja só ocupariam
            metade da seção sem mudar nenhuma conversa.
          */}
          <HistoricoMensal
            selo={`Consolidado ${filial}`}
            chave={`loja:${filial}:${chave}`}
            carregar={(meses) => variaveisApi.historicoMensalDaLoja(filial, { meses, visao })}
            graficos={['vendas']}
          />
        </div>
      )}

      {/*
        O QUE JÁ ESTÁ SENDO FEITO — o terceiro tempo da reunião, agora também aqui.

        O bloco existia só no N4. Entrou nesta tela em 11/09/2026, quando a aba
        "nível abaixo" saiu da lista de Ações: a visão gerencial não acabou, ela
        MUDOU DE LUGAR. Palavra do analista: *"o mesmo acontece pro N2 — ao
        clicar no GD do N3 ele vai ver os indicadores e no final vê as ações
        daquele N3"*.

        SÓ PARA QUEM OLHA DE CIMA, como no N4: o próprio N3 já tem a lista
        completa dele na tela de Ações, e repeti-la dentro da própria reunião
        daria duas listas para uma pergunta. Quem vem de cima é que passa por
        várias lojas e precisa ver o que está em pé em cada uma.
      */}
      {olhandoDeCima && filialDoQuadro !== null && (
        <AcoesDaLoja filial={filialDoQuadro} />
      )}
      </div>
    </>
  )
}

/** Um KPI do cabeçalho: 74% / 85%, com a composição embaixo. */
function Kpi({
  rotulo,
  icone,
  percentual,
  meta,
  composicao,
  nota,
  faisca,
  semana,
}: {
  rotulo: string
  icone: string
  percentual: number | null
  meta: number | null
  /**
   * Aceita NO, e nao apenas texto.
   *
   * Era `string`, e o cartao de gerencia precisa de "VENDAS R$ 33,95 mi
   * META R$ 31,54 mi" com os dois ROTULOS em cinza pequeno e os valores em
   * tinta cheia. Numa string os quatro pedacos viriam com o mesmo peso, e o
   * olho passaria a ler quatro coisas em vez de dois pares.
   */
  composicao: ReactNode
  nota?: string | null
  /** As cinco semanas. Ausente = sem série para esta variável. */
  faisca?: Array<number | null>
  /** Qual ponto ganha o círculo cheio. */
  semana: number
}) {
  const ok = naMeta(percentual, meta)

  /*
   * TRÊS estados, e o do meio é o que faltava.
   *
   * Era `ok === false ? vermelho : verde`, e `null` -- sem meta cadastrada --
   * caía no verde. A tela mostrava 43% em verde ao lado da frase "sem meta na
   * competência": o número afirmando que está bom, e a legenda dizendo que
   * ninguém mediu.
   *
   * `naMeta` já documenta a regra ("null não é fora: é ausência de
   * comparação"), e ela existe para não pintar de VERMELHO o que não se sabe.
   * Pintar de VERDE é o mesmo erro na direção pior: vermelho faz alguém
   * conferir, verde faz todo mundo seguir em frente.
   */
  const cor = tintaDoFarol(ok)

  return (
    <div className="n3-kpi">
      <span className="n3-kpi-n">
        <span aria-hidden>{icone}</span>
        {rotulo}
      </span>
      <span className="n3-kpi-r">
        <span className="n3-kpi-v" style={{ color: cor }}>
          {percentual === null ? '—' : `${Math.round(percentual)}%`}
        </span>
        {meta !== null && <span className="n3-kpi-m">/ {Math.round(meta)}%</span>}
      </span>
      {/*
        A BARRA dá escala ao percentual: 92% e 104% parecem vizinhos escritos, e
        são lados opostos da meta. De longe, numa reunião em pé, ninguém lê dois
        dígitos -- vê a barra.

        DEPOIS da composição, e não antes. Estava entre o número e a composição,
        e era o ÚNICO dos quatro lugares com barra nesta ordem -- os dois
        cartões do topo e a linha de área do N4 a põem no fim. Ler os números e
        depois o desenho deles funciona; alternar número, desenho, número
        obriga a voltar.
      */}
      <span className="n3-kpi-c">{composicao}</span>
      <Barra percentual={percentual} alvo={meta} />
      {nota && <span className="n3-kpi-c" style={{ color: 'var(--ter)', fontWeight: 400 }}>{nota}</span>}
      {faisca && <Faisca serie={faisca} meta={meta} semana={semana} rotulo={rotulo} />}
    </div>
  )
}

function CartaoGerencia({
  numeros,
  indicador,
  semana,
  aoEntrar,
}: {
  /*
   * Os números vêm PRONTOS do pai (§7.38). O cartão buscava os próprios, e por
   * isso o pai não sabia ordenar por gravidade nem somar a loja -- cada linha
   * conhecia só a si mesma. As `queryKey` são as mesmas, então nada foi buscado
   * duas vezes na troca.
   */
  numeros: NumerosDaGerencia
  indicador: string
  semana: number
  /**
   * Chamado ao entrar no N4 desta gerência, ANTES da navegação.
   *
   * Serve para o cabeçalho dizer onde a pessoa está: quem chega aqui simulando
   * uma visão continua simulando, e o chip tem de acompanhar o degrau que ela
   * acabou de descer. Ver `entrarNaGerencia` no pai.
   */
  aoEntrar: (nomeDaGerencia: string) => void
}) {
  const { gerencia, vendedor: rVendedor, vendas: rVendas } = numeros

  const variaveis = gerencia.categorias.find((c) => c.indicador === indicador)?.variaveis ?? []
  const varVendedor = variaveis.find((v) => ehVendedor(v.nome))
  const varVendas = variaveis.find((v) => !ehVendedor(v.nome))

  // Alvo 100 por definição (achievement), não patamar guardado. Ver ALVO_PERFORMANCE.
  const okVendas = naMeta(rVendas?.percentual ?? null, ALVO_PERFORMANCE)

  /**
   * O VEREDITO É DE VENDAS — a mesma regra do N4 (§7.37).
   *
   * Combinava as duas, e por isso duas variáveis sem meta davam `false`: o selo
   * dizia **"Na meta"** em verde sobre uma gerência que ninguém comparou com
   * nada. Vendas responde sozinha, com alvo 100% por definição (ALVO_PERFORMANCE);
   * Vendedor fica sem patamar de propósito, porque exigir um poria em vermelho
   * toda equipe com um vendedor abaixo da cota.
   *
   * As duas telas precisam concordar: são a MESMA gerência, e um selo verde no
   * N3 ao lado de um vermelho no N4 não teria como ser explicado.
   */

  /* A cor desta gerência -- a mesma da faixa do N4. Ver `coresDaGerencia`. */
  const cores = coresDaGerencia(gerencia.nome)

  /*
   * As áreas DESTA gerência de cada lado da meta, para os dois chips.
   *
   * Só entram as que têm meta: área sem denominador não está nem dentro nem
   * fora dela, e contá-la como "fora" acusaria de atraso quem ninguém mediu.
   *
   * O corte por `< 100` repete o do cartão do topo DE PROPÓSITO: a soma dos
   * chips das gerências tem de dar o chip da loja.
   */
  const comMetaAqui = numeros.areasVendas.filter(
    (a) => a.denominador !== null && a.denominador > 0,
  )
  const foraAqui = comMetaAqui.filter((a) => (a.percentual ?? 0) < 100).length

  return (
    <section
      /*
        Sem `alerta` nem `aberta`. A primeira existia para a regra de borda
        vermelha que virou a tarja inline abaixo; a segunda, para o acordeão --
        e o cartão não abre mais nada, ele navega. Classe sem regra manda quem
        for mexer procurar um CSS que não existe.
      */
      className="n3-ger"
      /* Verde na meta, vermelho fora, cinza sem meta. Ver `tarjaDoFarol`. */
      style={{ borderLeft: `4px solid ${tarjaDoFarol(okVendas)}` }}
    >
      {/*
        `Link`, e não `button` com `navigate`: é navegação, e o elemento certo
        dá de graça o que um botão não dá -- abrir em nova aba com ctrl+clique,
        copiar o endereço, e o cursor de link. A reunião do N3 abre duas
        gerências em duas abas com frequência.

        A GERÊNCIA VAI NA URL, e por ID. O id é por (filial, gerência), então
        ele já identifica a loja -- não precisa de um segundo parâmetro, e não
        há como a filial do link discordar da gerência dele.
      */}
      <Link
        to={`/reuniao?gerencia=${gerencia.id}&de=n3`}
        className="n3-cabeca"
        /*
          `onClick` junto do `Link`, e nao no lugar dele: o clique atualiza a
          VISAO e o `Link` continua navegando, entao ctrl+clique e "copiar
          endereco" seguem funcionando. Um `button` com `navigate` daria a
          atualizacao e tiraria as duas.

          Nao dispara em ctrl+clique com aba nova? Dispara -- e ai a visao muda
          nesta aba tambem. E' o preco aceitavel: a alternativa e' inspecionar
          `event.ctrlKey`/`metaKey`/`button` aqui, uma regra de plataforma
          copiada dentro de um cartao de indicador.
        */
        onClick={() => aoEntrar(gerencia.nome)}
      >
        <span className="n3-titulo-ger">
          {/*
            O MARCADOR da cor da gerência, antes do nome.

            A mesma cor da faixa do N4 (§7.54): numa lista que troca de quadro a
            cada cartão, a cor diz de qual antes de qualquer texto ser lido. Sem
            ela os dois cartões são a mesma caixa branca com nomes parecidos --
            "Construção" e "Não Construção" diferem por uma palavra.
          */}
          <span className="n3-nome" style={{ display: 'block' }}>
            <span className="n3-ponto-ger" style={{ background: cores.destaque }} aria-hidden />
            {nomeLegivel(gerencia.nome)}
          </span>
          <span className="n3-sup">{areas(gerencia.areasVenda.length)} de venda</span>
          {/*
            OS DOIS CHIPS, por gerência -- os mesmos que o cartão do topo tem
            para a loja.

            Substituem o selo "Na meta / Fora da meta" e a linha "Faltam R$ X".
            O selo dizia UM bit sobre treze áreas; os chips dizem onde a
            gerência está partida, que é a pergunta seguinte da reunião: "6 na
            meta e 7 fora" manda abrir o acordeão, "Fora da meta" não manda
            nada.

            A regra de corte é a MESMA do cartão do topo (percentual < 100), e
            tem de continuar sendo: a soma dos chips das gerências é o chip da
            loja, e duas regras diferentes fariam os dois números discordarem na
            mesma tela.
          */}
          {comMetaAqui.length > 0 && (
            <span className="n3-chips">
              <span className="n3-chip-mini ruim">{areas(foraAqui)} fora da meta</span>
              <span className="n3-chip-mini ok">
                {areas(comMetaAqui.length - foraAqui)} na meta
              </span>
            </span>
          )}
        </span>

        {/* Vendas antes de vendedores, como no topo: o fato, depois quem o sustentou. */}
        {varVendas && (
          <Kpi
            rotulo="Vendas na meta"
            icone="R$"
            percentual={rVendas?.percentual ?? null}
            meta={ALVO_PERFORMANCE}
            /*
              "Vendas x · Meta y", e não "x de y".
              "de" não dizia QUAL era qual: 33,95 de 31,54 se lê como fração, e
              numa fração o segundo número é o total -- aqui ele é a meta, e o
              primeiro pode ser maior. Os rótulos tiram a ambiguidade sem
              acrescentar linha.
            */
            composicao={
              rVendas ? (
                <ComposicaoVendas
                  realizado={rVendas.numerador}
                  meta={rVendas.denominador}
                  ok={okVendas}
                />
              ) : (
                'sem meta na competência'
              )
            }
            semana={semana}
            {...(numeros.serieVendas.length > 0 ? { faisca: numeros.serieVendas } : {})}
          />
        )}
        {varVendedor && (
          <Kpi
            rotulo="Vendedores na meta"
            icone="👤"
            percentual={rVendedor?.percentual ?? null}
            meta={varVendedor.meta}
            composicao={
              rVendedor && rVendedor.denominador > 0
                ? `${rVendedor.numerador} de ${rVendedor.denominador} vendedores`
                : 'ninguém na conta'
            }
            semana={semana}
            {...(numeros.serieVendedor.length > 0 ? { faisca: numeros.serieVendedor } : {})}
          />
        )}

        {/*
          A SETA no FIM da linha, e não no começo.

          Ela abria o acordeão e girava 90° para baixo -- na esquerda, apontando
          para o conteúdo que ia surgir logo abaixo. Agora o cartão NAVEGA, e a
          seta virou o "ir para": ela pertence ao fim do percurso de leitura,
          depois dos números, como em qualquer linha de lista que leva a outra
          tela. Na esquerda apontando para a direita ela ficava contra o
          sentido da leitura.
        */}
        {/*
          O DESTINO ESCRITO, e não só a seta.

          A seta sozinha diz "leva a algum lugar"; ela não diz QUAL. Palavra do
          analista (10/09/2026): *"ao passar o botão na área de venda não dá
          pra saber que vai pro N4 ao clicar"*. E o aviso que existia estava no
          cabeçalho da seção, a três cartões de distância -- lido uma vez,
          esquecido nos seguintes.

          "N4" e não "o quadro da gerência": é a mesma escolha do botão de volta
          da outra tela ("← Voltar para o N3"), e pelo mesmo motivo escrito
          lá -- quem trabalha aqui fala por nível, e o cabeçalho já chama as
          telas assim.

          VISÍVEL EM REPOUSO, e não só no hover: num quadro projetado numa
          parede o mouse não passa em lugar nenhum, e quem opera pelo teclado
          também não. O hover só REFORÇA o que já está escrito.
        */}
        <span className="n3-ir" aria-hidden>
          <span className="n3-ir-txt">Abrir o N4</span>
          <span className="n3-ir-seta">→</span>
        </span>
      </Link>
    </section>
  )
}






/**
 * O total da loja — "é por ela que você responde no N2".
 *
 * Soma numerador e denominador das gerências, nunca a média dos percentuais:
 * promediar pesaria uma gerência de 8 áreas igual a uma de 13, e o número da
 * loja deixaria de ser o cumprimento dela.
 */
/**
 * A BARRA de progresso contra o alvo.
 *
 * Ela existe porque o número sozinho não tem escala: 92% e 104% parecem
 * vizinhos escritos, e são lados opostos da meta. A barra põe os dois contra a
 * mesma régua, e a cor faz o resto de longe — numa reunião em pé ninguém lê
 * dois dígitos, vê a barra.
 *
 * **Passa de 100% e a barra não passa.** O trilho é a meta; encher além dele
 * exigiria uma segunda régua para o excedente, e o que importa ali é "chegou".
 */
function Barra({ percentual, alvo }: { percentual: number | null; alvo: number | null }) {
  if (percentual === null) return <span className="n3-barra-vazia" aria-hidden />
  const cheio = Math.max(0, Math.min(100, alvo && alvo > 0 ? (percentual / alvo) * 100 : percentual))
  /* Duas faixas: estas telas são do GD de Vendas. Ver `Trilho`, no N4. */
  const faixa = alvo === null ? 'sem' : percentual >= alvo ? 'ok' : 'ruim'
  return (
    <span className="n3-barra-trilho" aria-hidden>
      <span className={`n3-barra-cheio ${faixa}`} style={{ width: `${cheio}%` }} />
    </span>
  )
}

/**
 * O delta contra a semana anterior, em pontos percentuais.
 *
 * É o que transforma um número num movimento: 97% parado e 97% subindo pedem
 * conversas diferentes, e a tela anterior não sabia distinguir os dois.
 *
 * `p.p.` e não `%`: subir de 92% para 95% são três PONTOS percentuais, não 3%.
 * A diferença importa aqui porque o número ao lado já é um percentual, e somar
 * percentual de percentual é o erro clássico deste tipo de painel.
 */
function Delta({ valor, semana }: { valor: number | null; semana: number }) {
  if (valor === null) return null
  const sinal = valor > 0 ? '+' : ''
  return (
    <span className={`n3-delta ${valor > 0 ? 'sobe' : valor < 0 ? 'desce' : ''}`}>
      {sinal}
      {valor.toFixed(1).replace('.', ',')} p.p. vs S{semana - 1}
    </span>
  )
}

/**
 * O cabeçalho da loja: o que falta, e os dois indicadores.
 *
 * O primeiro cartão é o único da tela que responde em REAIS, e é de propósito:
 * ele é a pergunta da reunião ("quanto falta para bater a semana?"), enquanto
 * os outros dois são como se está indo.
 */
function CabecalhoDaLoja({
  diferenca,
  vendas,
  vendedor,
  areasFora,
  areasComMeta,
  numeros,
  semana,
  emCurso,
}: {
  /** Meta menos projeção, COM SINAL: negativa quando a projeção já passou. */
  diferenca: number | null
  vendas: { numerador: number; denominador: number }
  vendedor: { numerador: number; denominador: number }
  areasFora: number
  areasComMeta: number
  numeros: NumerosDaGerencia[]
  semana: number
  /** O período escolhido ainda está correndo. Ver `periodoEmCurso`. */
  emCurso: boolean
}) {
  const alcancada = diferenca !== null && diferenca <= 0
  /**
   * Quanto falta EM % DA META, para a legenda do cartao de projecao.
   *
   * Sai da mesma `diferenca` que o numero grande mostra em reais, dividida pela
   * meta -- entao os dois nunca discordam. Calcular aqui, e nao dentro de
   * `legendaDaMeta`, e' o que mantem a conta ao lado da meta que a origina.
   */
  /**
   * O percentual SOBRE A META: positivo quando a projeção passa dela.
   *
   * Orientação oposta à de `diferenca`, que é `meta - projeção` -- e por isso
   * o sinal aqui é invertido, e não copiado. Se as duas saíssem da mesma
   * subtração sem inversão, o cartão mostraria "+R$ 1,24 mi" ao lado de
   * "-6,2%": o mesmo fato com dois sinais, em duas linhas vizinhas.
   */
  const pctSobreAMeta =
    vendas.denominador > 0
      ? ((vendas.numerador - vendas.denominador) / vendas.denominador) * 100
      : null
  const pctVendas = vendas.denominador > 0 ? (vendas.numerador / vendas.denominador) * 100 : null
  const pctVendedor =
    vendedor.denominador > 0 ? (vendedor.numerador / vendedor.denominador) * 100 : null

  /*
   * O delta da LOJA sai da soma das séries das gerências, semana a semana --
   * não da média dos deltas delas. Média de percentuais é o erro que o projeto
   * inteiro evita: uma gerência de 8 áreas pesaria igual a uma de 13.
   *
   * Só dá para somar assim porque as séries vêm do mesmo cálculo do KPI, e há
   * teste disso (§7.25).
   */
  const deltaVendas = deltaDaLoja(numeros, semana, 'vendas')
  const deltaVendedor = deltaDaLoja(numeros, semana, 'vendedor')

  /*
   * As séries das cinco semanas, para as faíscas. Mesma fonte do delta ao lado
   * do rótulo: ele é a diferença de dois pontos DESTA linha, então os dois não
   * têm como discordar.
   */
  const serieVendas = serieDaLoja(numeros, 'vendas')
  const serieVendedor = serieDaLoja(numeros, 'vendedor')

  return (
    <div className="n3-topo">
      {/*
        VENDAS NA META vem primeiro, e a PROJEÇÃO depois.

        A reunião abre pelo indicador -- "estamos em 106%" é a pergunta do
        quadro --, e a projeção em reais é a consequência dele: quanto isso vira
        no fechamento do mês. Começava pela projeção, que é o número mais
        chamativo e o mais derivado.

        Os dois chips de área foram para o cartão de Vendas: eles desdobram o
        INDICADOR, não a projeção em reais.
      */}
      <div className="n3-topo-card">
        <span className="n3-topo-linha">
          <span className="n3-topo-rot">Vendas na meta</span>
          <Delta valor={deltaVendas} semana={semana} />
        </span>
        {/*
          UMA FAIXA POR LINHA, e não o número disputando lugar com o texto.

          Estava tudo numa `.n3-topo-linha` (`space-between`, com wrap): quando
          o texto não cabia ao lado do número -- e o de Vendas nunca cabe, com
          "VENDAS x | META y" --, ele quebrava para baixo e empurrava a barra.
          Medido: a barra deste cartão em y=141 e a do cartão vizinho em y=89.
          Lado a lado, 52px de desalinho, e variável com a largura da tela.

          Com uma faixa por linha os três cartões têm o MESMO ritmo vertical:
          rótulo, número, texto, barra caem no mesmo y em qualquer largura,
          porque nenhuma faixa depende de caber ao lado de outra.
        */}
        <span className="n3-topo-par">
          <span
            className={`n3-topo-v ${
              pctVendas === null ? 'n3-vazio' : pctVendas >= 100 ? 'n3-ok' : 'n3-ruim'
            }`}
          >
            {pctVendas === null ? '—' : `${Math.round(pctVendas)}%`}
          </span>
          {/*
            A referência da meta. Fixa em 100 porque a barra abaixo também usa
            `alvo={100}`: são a mesma régua, e tirá-la de lugares diferentes
            seria a chance de discordarem.
          */}
          {pctVendas !== null && <span className="n3-topo-m">/ 100%</span>}
        </span>
        <span className="n3-topo-c">
          {vendas.denominador > 0 ? (
            <ComposicaoVendas
              realizado={vendas.numerador}
              meta={vendas.denominador}
              ok={pctVendas === null ? null : pctVendas >= 100}
            />
          ) : (
            'sem meta na competência'
          )}
        </span>
        <Barra percentual={pctVendas} alvo={100} />
        {/*
          A FAÍSCA da loja -- as cinco semanas.

          Ela e o delta ao lado do rótulo não se repetem: o delta é o ÚLTIMO
          movimento ("+1,2 p.p. vs S1") e a faísca é a forma do caminho. 97%
          parado, subindo e caindo pedem três conversas, e o delta sozinho
          confunde a segunda com a terceira.

          Fica DEPOIS da barra e ANTES dos chips: número, régua e tendência são
          o mesmo assunto -- o indicador no tempo --, e os chips são outro: o
          desdobramento por área.
        */}
        <Faisca serie={serieVendas} meta={100} semana={semana} rotulo="Vendas na meta" />
        {/*
          OS DOIS CHIPS ficam com VENDAS NA META, e não com a projeção.

          "6 de 12 áreas fora da meta" é o desdobramento DESTE indicador: diz
          de onde vem o percentual acima. Estavam no cartão de projeção por
          terem nascido junto dele, e ali respondiam a uma pergunta que aquele
          cartão não faz -- o dele é quanto falta em reais.
        */}
        {areasComMeta > 0 && (
          <div className="n3-chips">
            <span className="n3-chip-mini ruim">
              {areasFora} de {areas(areasComMeta)} fora da meta
            </span>
            <span className="n3-chip-mini ok">{areas(areasComMeta - areasFora)} na meta</span>
          </div>
        )}
      </div>
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
      <div className="n3-topo-card destaque">
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
        <span className="n3-topo-rot">Gap (Projeção vs Meta)</span>
        {diferenca === null ? (
          <>
            <span className="n3-topo-v">—</span>
            <span className="n3-topo-c">sem meta de venda cadastrada</span>
          </>
        ) : (
          <>
            {/* O farol no número, e não só na barra. Ver `corDoFarol` no N4. */}
            <span className={`n3-topo-v ${alcancada ? 'n3-ok' : 'n3-ruim'}`}>
              {alcancada ? `+${dinheiro(-diferenca)}` : dinheiro(diferenca)}
            </span>
            {/* A LEGENDA acompanha o farol do número: as duas dizem a mesma
                coisa, e uma cinza ao lado de um número verde faria o olho
                procurar a diferença entre elas. */}
            <span className={`n3-topo-c ${alcancada ? 'n3-ok' : 'n3-ruim'}`}>
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
              <span className="n3-topo-proj">
                <span className="n3-topo-rot">Projeção de fechamento</span>
                <span className={`n3-topo-proj-v ${alcancada ? 'n3-ok' : 'n3-ruim'}`}>
                  {percentualComSinal(pctSobreAMeta)}
                </span>
              </span>
            )}
          </>
        )}
      </div>
      <div className="n3-topo-card">
        <span className="n3-topo-linha">
          <span className="n3-topo-rot">Vendedores na meta</span>
          <Delta valor={deltaVendedor} semana={semana} />
        </span>
        {/* Mesmas quatro faixas do cartão ao lado -- é o que os alinha. */}
        <span className="n3-topo-par">
          {/* Neutro sempre: Vendedor não tem patamar (§7.37). */}
          <span className="n3-topo-v n3-vazio">
            {pctVendedor === null ? '—' : `${Math.round(pctVendedor)}%`}
          </span>
        </span>
        <span className="n3-topo-c">
          {vendedor.denominador > 0
            ? `${vendedor.numerador} de ${vendedor.denominador} vendedores`
            : 'ninguém na conta'}
        </span>
        {/* Sem alvo: Vendedor não tem patamar de propósito (§7.37). */}
        <Barra percentual={pctVendedor} alvo={null} />
        {/* `meta={null}`: sem patamar não há régua tracejada para desenhar. */}
        <Faisca serie={serieVendedor} meta={null} semana={semana} rotulo="Vendedores na meta" />
      </div>

    </div>
  )
}

/**
 * O delta da LOJA: soma as séries das gerências antes de comparar.
 *
 * Não é a média dos deltas — uma gerência de 8 áreas pesaria igual a uma de 13.
 * Reconstrói o percentual da loja em cada semana a partir dos percentuais das
 * gerências ponderados pelo denominador ATUAL delas.
 *
 * **A ponderação é uma aproximação, e está registrada como tal**: o
 * denominador de cada semana passada pode ter sido outro. Para um delta de
 * cabeçalho, medir a direção certa basta; se um dia ele virar número de
 * cobrança, o caminho é uma rota de série da filial.
 */
/**
 * A SÉRIE DA LOJA, semana a semana: soma numerador e denominador das
 * gerências, nunca a média dos percentuais delas.
 *
 * Aqui o peso é o DENOMINADOR de cada gerência -- uma de 8 áreas não pode
 * pesar igual a uma de 13. É a mesma regra do consolidado do topo, e a que o
 * projeto inteiro segue.
 *
 * Extraída de `deltaDaLoja`, que já fazia esta conta por dentro para pegar
 * duas semanas. A faísca precisa das cinco, e reescrever a ponderação num
 * segundo lugar seria a cópia que envelhece -- com um sintoma que ninguém
 * confere: uma linha de tendência plausível e diferente do número ao lado.
 */
function serieDaLoja(
  numeros: NumerosDaGerencia[],
  qual: 'vendas' | 'vendedor',
): Array<number | null> {
  const pesoDe = (n: NumerosDaGerencia) =>
    (qual === 'vendas' ? n.vendas?.denominador : n.vendedor?.denominador) ?? 0
  const serieDe = (n: NumerosDaGerencia) => (qual === 'vendas' ? n.serieVendas : n.serieVendedor)

  return SEMANAS.map((_, i) => {
    let soma = 0
    let peso = 0
    for (const n of numeros) {
      const v = serieDe(n)[i]
      const w = pesoDe(n)
      if (v == null || w <= 0) continue
      soma += v * w
      peso += w
    }
    return peso > 0 ? soma / peso : null
  })
}

function deltaDaLoja(
  numeros: NumerosDaGerencia[],
  semana: number,
  qual: 'vendas' | 'vendedor',
): number | null {
  const serie = serieDaLoja(numeros, qual)
  const atual = serie[semana - 1] ?? null
  const anterior = serie[semana - 2] ?? null
  if (atual === null || anterior === null) return null
  return atual - anterior
}

/**
 * O bloco "o que já está sendo feito" do quadro do N3 desta loja.
 *
 * Só a BUSCA mora aqui; o desenho é o `BlocoDeAcoes`, o mesmo que a reunião do
 * N4 usa. O recorte é que difere: lá a gerência, aqui o quadro da loja.
 */
function AcoesDaLoja({ filial }: { filial: string }) {
  const consulta = useAcoesDaLoja(filial)
  const todas: ResumoAcao[] = consulta.data?.contramedidas ?? []

  if (consulta.isLoading) return null

  return (
    <div style={{ marginTop: 20 }}>
      <BlocoDeAcoes
        acoesAbertas={todas.filter((a) => a.status !== 'CONCLUIDA')}
        vazio="Nenhuma ação aberta nesta loja"
      />
    </div>
  )
}
