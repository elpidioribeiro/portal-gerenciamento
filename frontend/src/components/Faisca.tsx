/**
 * O minigráfico de cinco semanas ao lado do KPI.
 *
 * Existe porque **a tendência é a história**: `88-71-64-57` é uma conversa
 * diferente de `57%`, e antes só aparecia clicando semana por semana. É o que
 * os dois protótipos põem ali — `docs/demo-n3.html` e `docs/demo-n4.html` — com
 * a mesma forma: linha, meta tracejada, e a semana selecionada como círculo
 * cheio.
 *
 * Os pontos vêm do MESMO cálculo do KPI, uma vez por semana (rota
 * `/serie-semanal`), e há teste garantindo que o ponto da semana escolhida é o
 * número grande ao lado. Reimplementar a conta aqui, mais barato, é como os
 * dois passariam a discordar — e num gráfico a discordância nem chama atenção,
 * porque ninguém confere ponto a ponto.
 */

const LARGURA = 92
const ALTURA = 30

export function Faisca({
  serie,
  meta,
  semana,
  rotulo,
}: {
  /** Um valor por semana, na ordem. `null` onde não há conta. */
  serie: Array<number | null>
  /** A linha tracejada. Sem meta cadastrada não há régua, e ela some. */
  meta: number | null
  /** 1-based: qual ponto ganha o círculo cheio. */
  semana: number
  /** Para quem lê com leitor de tela — o gráfico é decorativo sem isto. */
  rotulo: string
}) {
  const pontos = serie
    .map((y, i) => (y === null ? null : { x: i, y }))
    .filter((p): p is { x: number; y: number } => p !== null)

  /*
   * Com menos de dois pontos não há linha — e um ponto solto num retângulo é
   * ruído, não informação. O protótipo faz o mesmo: some.
   */
  if (pontos.length < 2) return null

  const valores = pontos.map((p) => p.y).concat(meta === null ? [] : [meta])
  const min = Math.min(...valores) - 4
  const max = Math.max(...valores) + 4
  /*
   * Faixa achatada (todos os pontos iguais e sem meta) dividiria por zero e
   * mandaria a linha para fora do quadro.
   */
  const amplitude = max - min || 1

  const px = (i: number) => (i / Math.max(1, serie.length - 1)) * LARGURA
  const py = (y: number) => ALTURA - ((y - min) / amplitude) * ALTURA

  const caminho = pontos
    .map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`)
    .join(' ')

  const selecionado = pontos.find((p) => p.x === semana - 1)
  const ultimo = pontos[pontos.length - 1]!
  /*
   * A cor vem do ÚLTIMO ponto, não do selecionado: ela responde "como está
   * agora", enquanto o círculo diz "onde você está olhando". Pintar pelo
   * selecionado faria a linha mudar de cor ao navegar entre semanas, sugerindo
   * que algo mudou quando só o recorte mudou.
   *
   * **SEM META, CINZA** — e não verde (10/09/2026).
   *
   * A regra era `meta !== null && ultimo.y < meta ? vermelho : verde`, e o
   * `else` engolia dois casos diferentes: "está acima da meta" e "não há meta".
   * Performance Vendedor passa `meta={null}` de propósito (§7.37: não tem
   * patamar), então a faísca dela saía VERDE — afirmando "está bom" sobre o
   * indicador que a tela toda se recusa a julgar. O número ao lado está cinza,
   * o trilho embaixo está cinza, e a linha entre os dois estava verde.
   *
   * Pedido do analista, e é o mesmo defeito de §7.37 num terceiro lugar: três
   * elementos do mesmo KPI, e o último ainda pintava de verde a ausência de
   * comparação.
   *
   * `--ter` é o cinza que o trilho sem alvo já usa (`.n4-trilho-cheio.sem`),
   * e não um novo: dois cinzas dizendo a mesma coisa no mesmo cartão é como
   * eles passam a divergir.
   */
  const cor =
    meta === null
      ? 'var(--ter)'
      : ultimo.y < meta
        ? 'var(--cri-ponto)'
        : 'var(--ok-ponto)'

  return (
    <svg
      width={LARGURA}
      height={ALTURA}
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      style={{ overflow: 'visible', flexShrink: 0 }}
      role="img"
      aria-label={`${rotulo}: ${serie.map((v) => (v === null ? '—' : `${Math.round(v)}%`)).join(', ')}`}
    >
      {meta !== null && (
        <line
          x1="0"
          y1={py(meta).toFixed(1)}
          x2={LARGURA}
          y2={py(meta).toFixed(1)}
          stroke="var(--borda-hover)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      )}
      <path
        d={caminho}
        fill="none"
        stroke={cor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {selecionado && (
        <circle
          cx={px(selecionado.x).toFixed(1)}
          cy={py(selecionado.y).toFixed(1)}
          r="4"
          fill={cor}
          stroke="#fff"
          strokeWidth="2"
        />
      )}
    </svg>
  )
}
