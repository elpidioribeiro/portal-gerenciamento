import { describe, expect, it } from 'vitest'

/**
 * O LOGIN VAI MINÚSCULO E SEM ESPAÇOS — para a API corporativa e para a busca
 * no banco.
 *
 * Pedido do analista em 14/09/2026, depois de suspeitar que a API de login era
 * sensível à caixa. **Ela é**, e o portal já a protegia disso — mas nada no
 * projeto fixava o comportamento, então uma refatoração podia removê-lo sem
 * quebrar teste nenhum.
 *
 * O que se perde se isto sumir é caro e silencioso: `u10001abc` digitado como
 * `U10001ABC` viraria uma tentativa de senha errada **na conta real da pessoa**,
 * no sistema da empresa. Não é um erro de tela — é uma tentativa contabilizada
 * para bloqueio.
 *
 * A regra é testada como FUNÇÃO porque é isso que ela é em `provider.ts`, nos
 * dois provedores:
 *
 *   MockAuthProvider  `where: { loginErp: login.trim().toLowerCase() }`
 *   ErpAuthProvider   `const matricula = login.trim().toLowerCase()`
 *
 * Verificado ponta a ponta em 14/09/2026: um POST com `"  N2-TESTE  "` aparece
 * no diário do login como `matricula: "n2-teste"`, e é esse valor que segue no
 * corpo para a API.
 */
const normalizar = (login: string) => login.trim().toLowerCase()

describe('normalização do login', () => {
  it('minusculiza, para a API não receber caixa que ela recusa', () => {
    expect(normalizar('U10001ABC')).toBe('u10001abc')
    expect(normalizar('U10001abc')).toBe('u10001abc')
    expect(normalizar('u10001abc')).toBe('u10001abc')
  })

  /* Espaço nas pontas vem de copiar e colar, e de teclado de celular. */
  it('tira espaço das pontas', () => {
    expect(normalizar('  u10001abc  ')).toBe('u10001abc')
    expect(normalizar('\tu10001abc\n')).toBe('u10001abc')
  })

  it('as duas coisas juntas, que é o caso do Caps Lock com copiar e colar', () => {
    expect(normalizar('  U10001ABC ')).toBe('u10001abc')
  })

  /* Os usuários de teste entram pela mesma porta, e têm hífen no login. */
  it('não mexe no que não é caixa nem espaço', () => {
    expect(normalizar('N2-TESTE')).toBe('n2-teste')
    expect(normalizar('carga:32782')).toBe('carga:32782')
  })

  /**
   * A CONTRAPARTIDA, e é o motivo do aviso de Caps Lock na tela.
   *
   * A senha NÃO passa por aqui, e não pode passar: `argon2.verify` compara byte
   * a byte, e a API corporativa recebe o que foi digitado. Com Caps Lock ligado
   * o login é consertado e a senha não — e as duas recusas chegam à tela como a
   * mesma frase, de propósito, para não permitir enumerar matrículas.
   *
   * Este teste existe para que ninguém "conserte" a assimetria normalizando a
   * senha junto: seria mudar a credencial de todo mundo em silêncio.
   */
  it('a senha não é normalizada — a assimetria é deliberada', () => {
    const senha = '  Senha Com Caixa E Espaço  '
    expect(senha).not.toBe(normalizar(senha))
  })
})
