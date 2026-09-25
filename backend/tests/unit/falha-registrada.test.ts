import { describe, expect, it } from 'vitest'
import { falhaJaRegistrada, marcarFalhaRegistrada } from '../../src/modules/ingestao/service.js'

/**
 * A marca que decide entre UMA linha de falha e DUAS — ou nenhuma.
 *
 * A carga de Oracle tem dois guarda-chuvas (um por bloco, um por disparo) e a
 * gravação tem o dela, dentro de `executarCarga`. Os três registram a falha em
 * `sync_execucao`, e é esta marca que faz só o primeiro escrever.
 *
 * O que se protege falha nas duas direções, e as duas são silenciosas:
 *
 *  - marca que não pega → a mesma falha aparece duas vezes no histórico, e quem
 *    investiga acha que houve duas tentativas;
 *  - marca que pega demais → a falha não é registrada, que é exatamente o
 *    defeito de 10/09/2026 que tudo isto conserta.
 */

describe('marca de falha já registrada', () => {
  it('erro sem marca não está registrado', () => {
    expect(falhaJaRegistrada(new Error('qualquer'))).toBe(false)
  })

  it('marcar torna a marca visível', () => {
    const e = new Error('cadastro faltando')
    marcarFalhaRegistrada(e)
    expect(falhaJaRegistrada(e)).toBe(true)
  })

  /**
   * A marca é de UM erro, e não global.
   *
   * Se ela vazasse entre erros, a segunda falha de uma sequência de blocos
   * ficaria sem registro — e a carga de 60 dias tem dois blocos.
   */
  it('a marca não vaza para outro erro', () => {
    const a = new Error('a')
    const b = new Error('b')
    marcarFalhaRegistrada(a)
    expect(falhaJaRegistrada(b)).toBe(false)
  })

  /**
   * NÃO É ENUMERÁVEL: o erro vai para o log e para a resposta, e uma
   * propriedade a mais viraria ruído na mensagem que alguém lê às 3 da manhã.
   */
  it('não aparece ao serializar nem ao listar as chaves', () => {
    const e = new Error('ruptura de estoque')
    marcarFalhaRegistrada(e)
    expect(Object.keys(e)).toEqual([])
    /*
     * `getOwnPropertyNames` e não espalhar o erro num objeto: o lint recusa o
     * spread de instância de classe, e com razão -- ele perderia o protótipo, e
     * aqui perder o protótipo é justamente o que faria o teste passar por
     * vacuidade. Esta forma pergunta direto ao objeto.
     */
    expect(Object.getOwnPropertyNames(e)).not.toContain(
      'portalgd.falhaRegistradaEmSync',
    )
  })

  /**
   * `throw 'texto'` não aceita marca, e aí o registro sai duas vezes.
   *
   * É a escolha declarada: linha repetida é melhor do que falha sem rastro.
   * O teste existe para essa escolha não virar surpresa.
   */
  it('erro que não é objeto não aceita marca, e não quebra', () => {
    expect(() => marcarFalhaRegistrada('texto solto')).not.toThrow()
    expect(falhaJaRegistrada('texto solto')).toBe(false)
    expect(falhaJaRegistrada(null)).toBe(false)
    expect(falhaJaRegistrada(undefined)).toBe(false)
  })
})
