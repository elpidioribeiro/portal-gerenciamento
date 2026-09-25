import { describe, expect, it } from 'vitest'
import { consultar, consultarUma } from '../../src/lib/oracle.js'

/**
 * As travas da leitura no Oracle, exercitadas SEM banco.
 *
 * Todas as recusas aqui acontecem **antes** de abrir conexão, o que é
 * proposital: uma consulta de escrita não deve nem chegar ao servidor, e um
 * portal sem credencial configurada tem de dizer isso em vez de estourar num
 * erro de driver.
 *
 * Qualquer consulta que passe das travas falha em `obterPool`, e é justamente
 * isso que distingue "recusado pela trava" de "aceito e sem conexão".
 *
 * Isso depende de o ambiente de teste **não** ter `ORACLE_*`, e não depende do
 * acaso: o `vitest.config.ts` apaga as três variáveis mesmo quando o `.env` tem
 * credencial. Sem aquele apagamento, estes testes deixam de exercitar a trava e
 * passam a abrir conexão com o banco da empresa — foi medido, o
 * `consultarUma('SELECT 1 FROM DUAL')` chegou a voltar `{ '1': 1 }`.
 */

const semConexao = /Oracle não configurado/

describe('só SELECT chega ao banco', () => {
  const escritas = [
    ['INSERT', "INSERT INTO t (a) VALUES ('x')"],
    ['UPDATE', 'UPDATE t SET a = 1'],
    ['DELETE', 'DELETE FROM t'],
    ['MERGE', 'MERGE INTO t USING s ON (1=1) WHEN MATCHED THEN UPDATE SET a = 1'],
    ['DROP', 'DROP TABLE t'],
    ['TRUNCATE', 'TRUNCATE TABLE t'],
    ['ALTER', 'ALTER TABLE t ADD (b NUMBER)'],
    ['CREATE', 'CREATE TABLE t (a NUMBER)'],
    ['GRANT', 'GRANT SELECT ON t TO alguem'],
  ] as const

  for (const [nome, sql] of escritas) {
    it(`recusa ${nome}`, async () => {
      await expect(consultar(sql)).rejects.toThrow(/só executa SELECT|comando de escrita/)
    })
  }

  it('recusa escrita escondida depois de um SELECT', async () => {
    // O `garantirSelect` olha o comando inicial E procura verbo de escrita no
    // resto. Sem a segunda checagem, um `;` seguido de DELETE passaria pela
    // primeira.
    await expect(consultar('SELECT 1 FROM DUAL; DELETE FROM t')).rejects.toThrow(
      /comando de escrita/,
    )
  })

  it('aceita SELECT — a recusa passa a ser por falta de conexão', async () => {
    await expect(consultar('SELECT 1 AS UM FROM DUAL')).rejects.toThrow(semConexao)
  })

  it('aceita WITH (CTE)', async () => {
    await expect(consultar('WITH x AS (SELECT 1 A FROM DUAL) SELECT * FROM x')).rejects.toThrow(
      semConexao,
    )
  })

  /**
   * Comentário não pode servir de disfarce nem de falso positivo.
   *
   * As duas direções importam: um SELECT cujo comentário menciona `delete` é
   * legítimo e não pode ser recusado; e um `DELETE` precedido de comentário não
   * pode passar por estar depois de texto.
   */
  it('ignora comentário ao decidir', async () => {
    await expect(
      consultar('-- não faz delete nenhum\nSELECT 1 AS UM FROM DUAL'),
    ).rejects.toThrow(semConexao)

    await expect(consultar('/* inofensivo */ DELETE FROM t')).rejects.toThrow(
      /só executa SELECT|comando de escrita/,
    )
  })
})

describe('perfil de tempo da consulta', () => {
  /**
   * Duas classes de consulta com tetos opostos: a API precisa falhar rápido (o
   * login resolve o nível em 15 ms, com requisição HTTP esperando) e a carga de
   * indicador precisa de minutos (Perdas leva 60 a 104 s por mês e já estourou o
   * teto de 60).
   *
   * O que se testa aqui é que o parâmetro **existe e é aceito**, não o valor do
   * `callTimeout` — ele é propriedade de uma conexão que só nasce com credencial,
   * e a suíte não tem. A garantia de que o número certo chega lá está no
   * `env.ts`, com defaults validados por schema.
   */
  it('aceita o perfil de carga sem mudar a trava de SELECT', async () => {
    await expect(consultar('DELETE FROM t', {}, { perfil: 'carga' })).rejects.toThrow(
      /só executa SELECT|comando de escrita/,
    )
    await expect(consultar('SELECT 1 FROM DUAL', {}, { perfil: 'carga' })).rejects.toThrow(
      semConexao,
    )
  })

  it('o padrão é o perfil de api', async () => {
    await expect(consultar('SELECT 1 FROM DUAL', {})).rejects.toThrow(semConexao)
    await expect(consultar('SELECT 1 FROM DUAL', {}, { perfil: 'api' })).rejects.toThrow(
      semConexao,
    )
  })
})

describe('mensagem de configuração ausente', () => {
  it('diz o que falta, em vez de estourar no driver', async () => {
    await expect(consultar('SELECT 1 FROM DUAL')).rejects.toThrow(
      /ORACLE_USER, ORACLE_PASSWORD ou ORACLE_CONNECT_STRING/,
    )
  })

  it('vale também para consultarUma', async () => {
    await expect(consultarUma('SELECT 1 FROM DUAL')).rejects.toThrow(semConexao)
  })
})
