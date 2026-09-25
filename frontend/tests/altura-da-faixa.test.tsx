import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useAlturaDaFaixa } from '../src/hooks/useAlturaDaFaixa.js'

/**
 * O DEFEITO QUE ESTE ARQUIVO GUARDA.
 *
 * A primeira versão do hook recebia um `useRef` e media dentro de um
 * `useEffect`. Um objeto de ref não muda de identidade, então o efeito rodava
 * uma vez, na montagem — e nesse instante a faixa ainda não existe: no N3 ela
 * está atrás de `{gds.length > 0 && …}` e só aparece quando a resposta chega.
 *
 * O sintoma na tela não parecia isso. A variável ficava sem valor, o `calc` do
 * CSS caía no zero de fallback, e a faixa de aviso grudava em 124px — atrás da
 * faixa de identidade, que gruda no mesmo lugar com `z-index` maior. Ela fixava
 * e ficava escondida, e a queixa foi *"não fixou"*.
 *
 * O teste monta o caso REAL: a faixa entra na árvore depois. Com o `ref` de
 * função, o React chama a medição quando o elemento entra — que é o ponto.
 */

/** `jsdom` não implementa `ResizeObserver`, e o hook o usa. */
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  document.documentElement.style.removeProperty('--altura-faixa-teste')
})

function TelaComFaixaQueChegaDepois() {
  const [chegou, setChegou] = useState(false)
  const aFaixa = useAlturaDaFaixa('--altura-faixa-teste')
  return (
    <div>
      <button type="button" onClick={() => setChegou(true)}>
        chegou o dado
      </button>
      {chegou && (
        <div ref={aFaixa} data-testid="faixa">
          N3 · Vendas · CEN
        </div>
      )}
    </div>
  )
}

const variavel = () => document.documentElement.style.getPropertyValue('--altura-faixa-teste')

describe('useAlturaDaFaixa', () => {
  it('não publica altura enquanto a faixa não existe', () => {
    render(<TelaComFaixaQueChegaDepois />)
    expect(variavel()).toBe('')
  })

  it('publica quando a faixa ENTRA na árvore, e não só na montagem', () => {
    render(<TelaComFaixaQueChegaDepois />)
    act(() => {
      fireEvent.click(screen.getByRole('button'))
    })
    /*
     * O VALOR é zero no jsdom, que não faz layout — o que este teste prova é
     * que a medição RODOU para um elemento que apareceu depois. Era exatamente
     * isso que não acontecia: a variável ficava sem valor nenhum.
     */
    expect(variavel()).toBe('0px')
  })

  it('apaga a variável ao desmontar, para não vazar para a próxima tela', () => {
    const { unmount } = render(<TelaComFaixaQueChegaDepois />)
    act(() => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(variavel()).toBe('0px')
    unmount()
    /*
     * Sem isto, o painel do N2 — que não tem faixa — herdaria a altura da
     * reunião e mostraria o aviso flutuando, com um vão até o cabeçalho.
     */
    expect(variavel()).toBe('')
  })
})
