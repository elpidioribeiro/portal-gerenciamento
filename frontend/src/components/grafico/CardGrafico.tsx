import { GraficoLinha } from './GraficoLinha.js'
import type { Indicador as DadosIndicador } from '../../hooks/useIndicador.js'
import { formatarDesvio, formatarValorIndicador } from '../../lib/formato.js'

/**
 * A EVOLUÇÃO DO INDICADOR numa filial — o mesmo cartão em duas telas.
 *
 * Nasceu dentro de `Indicador.tsx`, e saiu quando o quadro do N2 passou a
 * mostrar o gráfico embaixo da matriz. Uma segunda cópia divergiria na primeira
 * mudança feita num lado só -- e as duas telas mostram a MESMA série, a do
 * indicador naquela filial.
 */
export function CardGrafico({
  dados,
  rotuloPeriodo,
}: {
  dados: DadosIndicador
  rotuloPeriodo: string
}) {
  const { indicador, filial, grafico, situacao, periodo } = dados

  /*
   * A ESCALA VEM DA RESPOSTA, e não é re-derivada aqui.
   *
   * Era `codigo === 'custo' ? 'mensal' : modo === 'ano' ? 'mensal' : 'semanal'`
   * — uma segunda cópia da decisão que o backend já toma, e que passou a ter
   * mais um caso (o quadro do N2 pede mensal mesmo no modo mês). Com a cópia,
   * o rótulo diria "semanal" sobre uma série de doze meses.
   */
  const contexto =
    grafico.escala === 'mensal' ? `mensal em ${periodo.ano}` : `semanal em ${rotuloPeriodo}`

  return (
    <section className="flex flex-col gap-5 rounded-card border border-borda bg-superficie p-6 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-titulo-secao">
          Evolução de {indicador.nome} · {filial.sigla} · {contexto}
        </h2>
        {indicador.codigo === 'custo' && periodo.modo === 'mes' && (
          <span className="rounded-full bg-andamento-bg px-3 py-1 text-micro font-semibold text-andamento-texto">
            Custo é apurado no fechamento mensal — sem série semanal
          </span>
        )}
      </div>

      <GraficoLinha
        pontos={grafico.pontos}
        escalaY={grafico.escalaY}
        yMeta={grafico.yMeta}
        situacao={situacao}
        formatarPonto={(p) =>
          grafico.plota === 'desvio'
            ? formatarDesvio(p.valor)
            : formatarValorIndicador(indicador.codigo, p.valorIndicador, indicador.casasDecimais)
        }
        legenda={`${indicador.nome} · ${filial.sigla} · ${contexto}`}
      />
    </section>
  )
}
