import type { Situacao } from '../../hooks/usePainel.js'
import type { AncoraEixo } from '../../hooks/useIndicador.js'
import { COR_META, COR_SEM_PATAMAR, COR_SERIE, COR_SITUACAO } from './cores.js'

/**
 * Gráfico de evolução — handoff seção "3", "Gráfico do indicador".
 *
 * SVG próprio, sem biblioteca: o handoff especifica a geometria exata (viewBox
 * 1300×200, `preserveAspectRatio: none`, escalas de Y não lineares por
 * indicador). Qualquer lib de gráficos brigaria com isso.
 *
 * As posições Y vêm calculadas do backend, que conhece a escala de cada
 * indicador. O componente só desenha.
 */

const LARGURA = 1300
const ALTURA = 200
/** Margem lateral para o primeiro e o último ponto não encostarem na borda. */
const MARGEM_X = 26


export interface PontoGrafico {
  rotulo: string
  valor: number | null
  valorIndicador: number | null
  desvio: number | null
  /** O farol daquele ponto — vem do servidor, pela mesma regra da célula. */
  situacao?: Situacao | null
  y: number | null
}

interface Props {
  pontos: PontoGrafico[]
  escalaY: AncoraEixo[]
  yMeta: number
  situacao: Situacao | null
  /**
   * Formata a pílula do ponto atual E os rótulos discretos ao longo da linha.
   *
   * Recebe o PONTO, não o valor do período: a pílula rotula o último ponto
   * plotado (a Sem 3, por exemplo), e mostrar ali o total do mês faria a
   * etiqueta contradizer a posição da bolinha no gráfico.
   *
   * O MESMO formatador serve os dois de propósito. Os rótulos discretos
   * mostravam o desvio percentual fixo no componente, e isso mentia em toda
   * linha que não plota desvio: no NPS a linha é de PONTOS (a pílula dizia
   * `83`) e os rótulos ao lado diziam `+14,4%`, o percentual sobre a meta —
   * dois significados na mesma linha. Só Vendas plota desvio; NPS, Perdas e
   * Custo plotam o valor.
   */
  formatarPonto: (ponto: PontoGrafico) => string
  /** Legenda abaixo do gráfico. */
  legenda: string
  altura?: number
  /**
   * A SÉRIE NÃO TEM ALVO — some a régua da meta, e os pontos ficam cinza.
   *
   * Performance Vendedor é "% do quadro apto que bateu a cota", e **ninguém
   * definiu um patamar** (§7.37). Sem isto, o componente pintaria tudo de
   * `acima` (o padrão de `situacao ?? 'acima'`) e desenharia uma régua em cima
   * de um número que não é meta: o gráfico afirmaria um veredito que o
   * indicador não faz, e em VERDE — o pior jeito de errar, porque ninguém
   * questiona um verde.
   */
  semPatamar?: boolean
}

export function GraficoLinha({
  pontos,
  escalaY,
  yMeta,
  situacao,
  formatarPonto,
  legenda,
  altura = 180,
  semPatamar = false,
}: Props) {
  const corDoPonto = (p: PontoGrafico) =>
    semPatamar ? COR_SEM_PATAMAR : COR_SITUACAO[p.situacao ?? situacao ?? 'acima']
  const corSituacao = semPatamar ? COR_SEM_PATAMAR : COR_SITUACAO[situacao ?? 'acima']

  const x = (i: number) =>
    pontos.length <= 1
      ? LARGURA / 2
      : MARGEM_X + (i * (LARGURA - MARGEM_X * 2)) / (pontos.length - 1)

  const comValor = pontos
    .map((p, i) => ({ ...p, i }))
    .filter((p): p is typeof p & { y: number } => p.y !== null)

  const ultimo = comValor[comValor.length - 1]
  const rotuloMeta = escalaY.find((a) => a.meta)?.rotulo ?? ''

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        {/* Coluna de rótulos do eixo Y — 74px, fora do SVG para não esticar. */}
        <div className="relative w-[74px] shrink-0" style={{ height: altura }}>
          {escalaY.map((a) => (
            <span
              key={a.rotulo}
              className={`absolute right-0 -translate-y-1/2 whitespace-nowrap text-micro ${
                a.meta ? 'font-bold' : 'font-medium text-texto-ter'
              }`}
              style={{ top: (a.y / ALTURA) * altura, ...(a.meta ? { color: corSituacao } : {}) }}
            >
              {a.rotulo}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/*
            Desvio de cada ponto sobre a meta, discreto. Fica FORA do SVG —
            dentro dele o texto seria deformado pelo preserveAspectRatio="none".

            Acompanha a linha (`top` vem do y do ponto) em vez de ficar numa
            faixa fixa: dá para ler a evolução seguindo os números. Quando o
            ponto está no alto, o rótulo desce para não sair do gráfico.
          */}
          {comValor
            // O último ponto já tem a pílula destacada com o mesmo número —
            // o rótulo discreto ali seria o valor repetido duas vezes.
            .filter((p) => p.i !== ultimo?.i)
            .map((p) => (
              <span
                key={`rot-${p.rotulo}`}
                className="tabular pointer-events-none absolute z-20 -translate-x-1/2 text-micro font-bold"
                style={{
                  left: `${(x(p.i) / LARGURA) * 100}%`,
                  top: (p.y / ALTURA) * altura + (p.y > 40 ? -20 : 14),
                  color: corDoPonto(p),
                }}
              >
                {formatarPonto(p)}
              </span>
            ))}

          {/*
            UM PONTO EM CADA MÊS, e fora do SVG.

            Dentro dele um `<circle>` viraria elipse: `preserveAspectRatio="none"`
            estica o desenho na horizontal, e o que vale para o texto vale para
            o círculo. Posicionado por `left`/`top` ele fica redondo em qualquer
            largura.

            A cor é o farol DAQUELE mês, e o anel branco é o que o separa da
            linha quando os dois se cruzam.
          */}
          {comValor.map((p) => (
            <span
              key={`pt-${p.rotulo}`}
              className="pointer-events-none absolute z-10 block rounded-full border-[2.5px] border-white"
              style={{
                left: `${(x(p.i) / LARGURA) * 100}%`,
                top: (p.y / ALTURA) * altura,
                width: 11,
                height: 11,
                marginLeft: -5.5,
                marginTop: -5.5,
                background: corDoPonto(p),
                boxShadow: '0 1px 3px rgba(15,27,51,.25)',
              }}
            />
          ))}

          <svg
            viewBox={`0 0 ${LARGURA} ${ALTURA}`}
            preserveAspectRatio="none"
            style={{ height: altura }}
            className="w-full overflow-visible"
            role="img"
            aria-label={legenda}
          >
            {/* Grade: uma linha por âncora do eixo. */}
            {escalaY.map((a) => (
              <line
                key={a.rotulo}
                x1={0}
                x2={LARGURA}
                y1={a.y}
                y2={a.y}
                stroke={a.y === ALTURA - 20 ? '#E3E3E7' : '#EEF1F6'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/*
              Linha de meta: LARANJA FIXO, e não a cor do status.

              Ela é a referência contra a qual se lê o gráfico, e referência não
              muda de cor com o resultado — pintá-la de verde quando o mês fecha
              bem faz a própria régua virar mais um sinal, e aí o leitor tem
              dois verdes dizendo a mesma coisa e nenhuma linha neutra para
              medir.
            */}
            {!semPatamar && (
              <line
                x1={0}
                x2={LARGURA}
                y1={yMeta}
                y2={yMeta}
                stroke={COR_META}
                strokeWidth={1.5}
                strokeDasharray="8 8"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Série. `non-scaling-stroke` mantém a espessura de 2,5px que o
                handoff pede: com preserveAspectRatio="none" o traço seria
                esticado na horizontal e ficaria visivelmente mais grosso na
                vertical. */}
            {comValor.length > 1 && (
              <polyline
                points={comValor.map((p) => `${x(p.i)},${p.y}`).join(' ')}
                fill="none"
                stroke={COR_SERIE}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}

          </svg>

          {/* Pílula do valor atual e eixo X ficam FORA do SVG: dentro dele o
              texto seria deformado pelo preserveAspectRatio="none". */}
          <div className="relative mt-1 h-6">
            {ultimo && (
              <span
                className="absolute -translate-x-1/2 rounded-full bg-navy px-[10px] py-[3px] text-legenda font-bold text-white"
                style={{ left: `${(x(ultimo.i) / LARGURA) * 100}%` }}
              >
                {formatarPonto(ultimo)}
              </span>
            )}
          </div>

          <div className="relative h-4">
            {pontos.map((p, i) => (
              <span
                key={p.rotulo}
                className="absolute -translate-x-1/2 text-micro font-semibold text-texto-ter"
                style={{ left: `${(x(i) / LARGURA) * 100}%` }}
              >
                {p.rotulo}
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="text-legenda text-texto-ter">
        {legenda}
        {rotuloMeta ? ` · meta ${rotuloMeta.replace(' · meta', '')}` : ''}
      </p>
    </div>
  )
}
