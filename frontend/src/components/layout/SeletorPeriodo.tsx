import { MESES, usePeriodo, type Periodo } from '../../contexts/PeriodoContext.js'
import { IconeCalendario, IconeChevronBaixo } from '../ui/Icones.js'

/**
 * Seletor de período da barra navy (spec-header, barra 1, item 4).
 *
 * Um `<select>` nativo sobreposto ao visual: teclado, leitor de tela e o
 * seletor do sistema operacional funcionam de graça, e o desenho da spec fica
 * intacto por baixo. Um menu customizado exigiria reimplementar tudo isso.
 */
export function SeletorPeriodo() {
  const { periodo, definir, rotulo } = usePeriodo()
  const anos = anosDisponiveis()

  const opcoes: Array<{ valor: string; texto: string; periodo: Periodo }> = []
  for (const ano of anos) {
    opcoes.push({ valor: `ano-${ano}`, texto: `Ano inteiro · ${ano}`, periodo: { modo: 'ano', ano, mes: 1 } })
    MESES.forEach((nome, i) => {
      opcoes.push({
        valor: `mes-${ano}-${i + 1}`,
        texto: `${nome} · ${ano}`,
        periodo: { modo: 'mes', ano, mes: i + 1 },
      })
    })
  }

  const valorAtual =
    periodo.modo === 'ano' ? `ano-${periodo.ano}` : `mes-${periodo.ano}-${periodo.mes}`

  return (
    <div className="relative flex items-center gap-[9px] rounded-controle border border-white/[.16] bg-white/[.08] px-[14px] py-[9px] transition-colors duration-hover hover:bg-white/[.12]">
      <IconeCalendario tamanho={15} cor="#C7D6EA" />
      <span className="text-corpo font-semibold text-white">{rotulo}</span>
      <IconeChevronBaixo tamanho={13} cor="#8FA6C4" />

      <select
        aria-label="Período"
        value={valorAtual}
        onChange={(e) => {
          const opcao = opcoes.find((o) => o.valor === e.target.value)
          if (opcao) definir(opcao.periodo)
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Anos oferecidos. A retenção do portal é por ano-calendário (ano corrente +
 * anterior), então a lista acompanha sozinha a virada do ano em vez de ser
 * cadastro.
 */
function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear()
  return [atual, atual - 1]
}
