import { useQuery } from '@tanstack/react-query'
import type { HistoricoMensal as Historico, MesDoHistorico } from '../lib/api.js'
import { GraficoLinha } from './grafico/GraficoLinha.js'

/**
 * DOZE meses, sempre, em cada gráfico desenhado.
 *
 * É o ano móvel: o mês corrente e os onze anteriores. Fixo, e não uma janela
 * que encolhe quando falta dado — mês sem consolidação aparece como moldura
 * vazia, e é assim que se vê que ele falta.
 */
const MESES = 12

/**
 * COMO VIEMOS ATÉ AQUI — os dois quadros da parede, mês a mês.
 *
 * O quadro semanal responde "como está indo"; este responde "como chegamos
 * aqui", que é a outra metade da reunião. Sem ele, uma semana ruim depois de
 * cinco boas se lê igual a uma semana ruim depois de cinco ruins.
 *
 * QUAIS gráficos é de quem chama, pelo `graficos`. O N4 desenha os dois; o N3
 * só Vendas -- decisão do analista, 08/09/2026. A tela do N3 já tem os dois
 * números de Vendedor no topo e no cartão de cada gerência, e o histórico dele
 * por LOJA responde uma pergunta que a reunião do gerente geral não faz.
 *
 * **Um gráfico por variável, nunca os dois no mesmo**, porque elas não
 * compartilham eixo nem farol:
 *
 *   VENDAS     % da meta do mês. Tem alvo (100%), então tem cor: verde acima,
 *              vermelho abaixo, e a régua da meta atravessando.
 *   VENDEDOR   % do quadro apto que bateu a cota. **Não tem patamar** (§7.37),
 *              então é CINZA -- pintar de verde exigiria um alvo que ninguém
 *              definiu.
 *
 * Mês sem dado não vira zero: fica como moldura vazia e esmaecida. Zero é um
 * resultado, ausência não é, e desenhá-los igual diria que a gerência não
 * vendeu nada num mês que ninguém mediu.
 */
export function HistoricoMensal({
  selo,
  chave,
  carregar,
  graficos = ['vendas', 'vendedor'],
  sobDemanda = false,
}: {
  /** O escopo, no selo: o nome da gerência no N4, o da loja no N3. */
  selo: string
  /** Parte variável da chave do cache -- escopo mais visão. */
  chave: string
  carregar: (meses: number) => Promise<Historico>
  /**
   * Quais gráficos desenhar. Os dois por padrão -- quem restringe é quem chama.
   *
   * O padrão é "os dois" e não "só vendas" de propósito: uma tela nova que
   * esqueça a prop mostra tudo o que tem, e sobrar gráfico é visível na hora.
   * Faltar é que passa despercebido.
   */
  graficos?: Array<'vendas' | 'vendedor'>
  /**
   * A seção foi PEDIDA por um clique, e não desenhada junto com a tela.
   *
   * Muda o que acontece quando não há dado: some (o padrão, para quem desenha
   * sempre) ou DIZ que não há. Sem isto, o "Ver histórico" do N4 abriria o
   * vazio quando a série do indicador ainda não alcançou nenhum mês — a tela
   * rolaria até um espaço em branco, que se lê como link quebrado.
   */
  sobDemanda?: boolean
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ['historico-mensal', chave],
    queryFn: () => carregar(MESES),
  })

  if (isPending) {
    return (
      <div className="rounded-card border border-borda bg-superficie p-6 shadow-card">
        <p className="text-corpo text-texto-sec">Carregando o histórico…</p>
      </div>
    )
  }
  if (error) return null

  /*
   * Duas condições, e são diferentes: `graficos` diz o que a TELA quer, e
   * `alcance` diz o que o DADO tem. Um gráfico pedido sem dado não é desenhado,
   * e a seção inteira desaparece quando nenhum dos pedidos tem dado -- em vez
   * de mostrar um título com nada embaixo.
   */
  const temVendas = graficos.includes('vendas') && data.alcance.vendas !== null
  const temVendedor = graficos.includes('vendedor') && data.alcance.vendedor !== null
  const vazio = !temVendas && !temVendedor
  if (vazio && !sobDemanda) return null

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="n4-bloco-t">Como viemos até aqui</h2>
          <p className="n4-sub">
            Fechamento contra a meta do mês, mês a mês. Mês sem dado fica esmaecido; o mês em
            curso é hachurado — nele o número é a projeção de fechamento, a mesma do cartão acima.
          </p>
        </div>
        <span className="n4-hist-selo">
          <span className="n4-hist-ponto" aria-hidden />
          {selo}
        </span>
      </div>

      {/*
        Pedido e sem dado: DIZ, em vez de sumir. E diz o que falta -- a
        consolidação mensal, que é carga, e não meta ou cadastro: mandar
        cadastrar meta aqui mandaria consertar a coisa errada.
      */}
      {vazio && (
        <div className="rounded-card border border-borda bg-superficie p-6 shadow-card">
          <p className="text-corpo text-texto-sec">
            Ainda não há histórico mensal deste indicador — a consolidação por mês não alcançou
            nenhuma competência.
          </p>
        </div>
      )}

      {temVendas && (
        <Grafico
          titulo="Performance Vendas"
          descricao="Fechamento sobre a meta do mês, em % — a régua é a meta"
          meses={data.meses}
          valorDe={(m) => m.vendas?.percentual ?? null}
          /*
           * O eixo NÃO começa em zero, e é deliberado: a série vive entre 85% e
           * 115%, e um eixo de zero comprimiria toda a variação em um décimo da
           * altura -- doze meses pareceriam iguais. O corte em 50% é seguro
           * porque a régua da meta fica visível, que é a referência que importa.
           */
          min={50}
          max={130}
          meta={100}
        />
      )}

      {temVendedor && (
        <Grafico
          titulo="Performance Vendedor"
          descricao="Vendedores que bateram a cota, em % do quadro apto"
          meses={data.meses}
          valorDe={(m) => m.vendedor?.percentual ?? null}
          // Aqui o eixo é de zero a cem porque é uma proporção de pessoas, e
          // ela usa a faixa inteira -- de 21% a 86% no mesmo trimestre.
          min={0}
          max={100}
          meta={null}
        />
      )}
    </section>
  )
}

/**
 * O rótulo NUNCA cruza a meta ao arredondar.
 *
 * `Math.round(99,6)` dá 100, e mar/26 aparecia como **"100" pintado de
 * vermelho**: o número dizia que bateu, a cor dizia que não. Num quadro de
 * parede isso se lê como defeito da ferramenta, e não como 99,6%.
 *
 * Arredonda na direção que preserva o lado da meta -- inteiro na tela, sem
 * contradizer o farol.
 */
function rotuloDoValor(v: number, meta: number | null): number {
  const r = Math.round(v)
  if (meta === null) return r
  if (v < meta && r >= meta) return Math.floor(v)
  if (v >= meta && r < meta) return Math.ceil(v)
  return r
}

/**
 * A MESMA LINHA DO N2 — e agora é o MESMO componente, não uma imitação.
 *
 * Isto era um gráfico de BARRAS, e o argumento estava escrito aqui: *"os meses
 * são categorias discretas, e a linha sugeriria que existe algo entre março e
 * abril"*. O argumento continua correto e **perdeu** para outro: o analista
 * abriu as duas telas lado a lado e pediu a identidade — *"quero o gráfico de
 * vendas e vendedores da N3 e N4 no mesmo padrão dos gráficos da N2"*, e depois
 * *"quero gráfico de linha também"*.
 *
 * Vale registrar o que se ganha, além de parecer igual: **é o mesmo
 * `GraficoLinha`**. Não há dois desenhos para manter alinhados, não há paleta
 * duplicada, e a próxima mudança no gráfico do N2 chega aqui sozinha. Antes,
 * "igual" dependia de alguém lembrar dos dois lados.
 *
 * O QUE MUDA DE VERDADE, e não é só a forma:
 *
 *  - **mês sem dado** vira `y: null`, e o componente PULA o ponto. A linha não
 *    desce a zero nem interpola: continua valendo que ausência não é zero;
 *  - **o mês em curso** era hachurado, e a hachura não existe numa linha. Ele
 *    passou para a DESCRIÇÃO, porque a informação é do número e não do desenho:
 *    o último ponto é projeção de fechamento, não fechamento.
 */
function Grafico({
  titulo,
  descricao,
  meses,
  valorDe,
  min,
  max,
  meta,
}: {
  titulo: string
  descricao: string
  meses: MesDoHistorico[]
  valorDe: (m: MesDoHistorico) => number | null
  min: number
  max: number
  meta: number | null
}) {
  /*
   * O SVG do `GraficoLinha` tem 200 de altura e cresce para BAIXO: `y = 0` é o
   * topo. A conta abaixo é a mesma das barras invertida -- lá a altura subia do
   * piso, aqui a coordenada desce do teto.
   */
  const ALTURA_SVG = 200
  const yDe = (v: number) =>
    ALTURA_SVG - ((Math.min(Math.max(v, min), max) - min) / (max - min)) * ALTURA_SVG

  const pontos = meses.map((m) => {
    const v = valorDe(m)
    return {
      rotulo: m.rotulo,
      valor: v,
      valorIndicador: v,
      desvio: null,
      /*
       * O farol é DO PONTO, e não da série: num histórico de doze meses há
       * meses acima e abaixo, e uma cor só para todos apagaria justamente a
       * leitura que o gráfico existe para dar.
       */
      situacao: v === null || meta === null ? null : v >= meta ? ('acima' as const) : ('abaixo' as const),
      // `null` PULA o ponto -- ver o comentário do componente.
      y: v === null ? null : yDe(v),
    }
  })

  /*
   * Cinco marcas, como nas barras: mais que isso vira grade, e a grade compete
   * com a série.
   *
   * A da META entra mesmo que não caia numa marca redonda -- ela é a referência
   * de leitura, e um eixo que não a mostra obriga a estimar onde ela está.
   */
  const marcas = [0, 1, 2, 3, 4].map((i) => Math.round(max - ((max - min) / 4) * i))
  const escalaY = [
    ...marcas
      .filter((v) => v !== meta)
      .map((v) => ({ valor: v, rotulo: `${String(v)}%`, y: yDe(v) })),
    ...(meta !== null && meta >= min && meta <= max
      ? [{ valor: meta, rotulo: `${String(meta)}%`, y: yDe(meta), meta: true }]
      : []),
  ]

  /* O mês em curso é PROJEÇÃO, e a linha não tem como hachurá-lo. */
  const emCurso = meses.some((m) => m.emCurso && valorDe(m) !== null)

  return (
    <section className="flex flex-col gap-5 rounded-card border border-borda bg-superficie p-6 shadow-card">
      <div>
        <h2 className="text-titulo-secao">{titulo}</h2>
        <p className="text-legenda text-texto-ter">
          {descricao}
          {emCurso ? ' — o último ponto é o mês em curso, e o número é a projeção de fechamento.' : ''}
        </p>
      </div>

      <GraficoLinha
        pontos={pontos}
        escalaY={escalaY}
        yMeta={meta === null ? ALTURA_SVG : yDe(meta)}
        /*
         * `null` porque quem manda é o farol DE CADA PONTO, acima. O componente
         * só usa este valor como reserva, para ponto sem situação própria.
         */
        situacao={null}
        semPatamar={meta === null}
        formatarPonto={(p) =>
          p.valor === null ? '' : `${String(rotuloDoValor(p.valor, meta))}%`
        }
        legenda={`${titulo} · doze meses${meta === null ? '' : ` · meta ${String(meta)}%`}`}
      />
    </section>
  )
}
