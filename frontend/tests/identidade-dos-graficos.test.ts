import { describe, expect, it } from 'vitest'
import {
  COR_META,
  COR_SEM_PATAMAR,
  COR_SERIE,
  COR_SITUACAO,
} from '../src/components/grafico/cores.js'

/**
 * OS GRÁFICOS DOS TRÊS NÍVEIS DESENHAM IGUAL.
 *
 * O quadro do N2 e o histórico do N3 e do N4 usavam a mesma paleta **por
 * coincidência**: `COR_SITUACAO` num arquivo, e `'#27ae60'` / `'#e74c3c'`
 * escritos soltos no meio do JSX do outro, em minúsculas. Funcionava porque os
 * valores batiam.
 *
 * Coincidência não é identidade. A primeira mudança de paleta feita num lado só
 * deixaria o verde do N2 diferente do verde do N4 — e ninguém veria, porque
 * ninguém abre as duas telas lado a lado. Foi exatamente assim que o analista
 * percebeu, em 14/09/2026: *"quero o gráfico de vendas e vendedores da N3 e N4
 * no mesmo padrão dos gráficos da N2, identidade"*.
 *
 * **A identidade em si é garantida pelo `import`**, e não por este arquivo: os
 * dois componentes leem de `grafico/cores.ts`, então não têm como divergir. O
 * que os testes abaixo guardam é a outra metade — que a fonte única carregue os
 * valores CERTOS. Centralizada e errada é pior que espalhada e certa, porque
 * parece resolvida.
 *
 * Os valores são os de `tailwind.config.ts`. Repetidos aqui de propósito: o
 * teste tem de falhar quando alguém mudar a paleta dos gráficos sem mudar o
 * tema, que é exatamente a divergência que ele existe para pegar.
 */
describe('identidade dos gráficos', () => {
  it('o farol é o do tema, e não uma paleta própria dos gráficos', () => {
    expect(COR_SITUACAO).toEqual({
      otimo: '#3581D8', //   otimo.ponto
      acima: '#27AE60', //   ok.ponto
      atencao: '#F39C12', // risco.ponto
      abaixo: '#E74C3C', //  critico.ponto
    })
  })

  it('a série sem patamar é o cinza dos rótulos', () => {
    // `texto.ter`. Performance Vendedor não tem alvo definido (§7.37), então
    // não tem cor de veredito — pintar de verde exigiria um patamar que não
    // existe.
    expect(COR_SEM_PATAMAR).toBe('#8592A8')
  })

  it('a linha da série é o navy da marca', () => {
    expect(COR_SERIE).toBe('#001F3F')
  })

  /**
   * A RÉGUA DA META é a única cor que NÃO sai do tema, e isso é deliberado.
   *
   * Ela não é um status — é uma referência, e não muda de cor com o resultado.
   * O teste a separa de `risco.ponto`, que é outro laranja e quer dizer outra
   * coisa: se os dois virassem o mesmo valor, a régua passaria a parecer um
   * alerta em todo gráfico.
   */
  it('a régua da meta não se confunde com o laranja de risco', () => {
    expect(COR_META).toBe('#F0A020')
    expect(COR_META).not.toBe(COR_SITUACAO.atencao)
  })
})
