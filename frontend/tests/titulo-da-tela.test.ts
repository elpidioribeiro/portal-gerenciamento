import { describe, expect, it } from 'vitest'
import { tituloDaTela } from '../src/lib/titulo-da-tela.js'

/**
 * O NOME DA TELA, no canto esquerdo do cabeçalho.
 *
 * Substituiu um breadcrumb que tinha UM item em cinco das oito rotas (§ da
 * direção B, 12/09/2026). O que este arquivo guarda é o que não pode voltar a
 * acontecer: **canto vazio**. Rota nova sem entrada no mapa, ou sessão ainda
 * carregando, precisam render alguma coisa — um cabeçalho com um buraco no
 * lugar do nome não dá erro, só fica errado.
 */
const n2 = { nivel: 'N2' as const, filial: null }
const n4 = { nivel: 'N4' as const, filial: 'NOR' }

describe('título da tela', () => {
  it('nomeia as rotas do dia a dia', () => {
    expect(tituloDaTela('/painel', n2, null).nome).toBe('Reunião diária')
    expect(tituloDaTela('/reuniao', n4, null).nome).toBe('Reunião diária')
    expect(tituloDaTela('/reuniao-n3', n2, null).nome).toBe('Reunião diária')
    expect(tituloDaTela('/acoes', n2, null).nome).toBe('Ações')
    expect(tituloDaTela('/pontos-causa', n2, null).nome).toBe('Pontos de causa')
    expect(tituloDaTela('/admin', n2, null).nome).toBe('Administração')
  })

  /* O segundo segmento entra só onde ele É a identidade da tela. */
  it('a contramedida se chama pelo código, e o desdobramento pelo par', () => {
    expect(tituloDaTela('/contramedida/AC-0311', n2, null).nome).toBe('AC-0311')
    expect(tituloDaTela('/indicador/vendas/NOR', n2, null).nome).toBe('vendas · NOR')
  })

  it('rota desconhecida cai no nome do portal, nunca em vazio', () => {
    expect(tituloDaTela('/rota-que-nao-existe', n2, null).nome).toBe('Portal GD')
    expect(tituloDaTela('/', n2, null).nome).toBe('Portal GD')
  })

  /**
   * A INVARIANTE DE QUE O CABEÇALHO DEPENDE, desde 12/09/2026.
   *
   * Ele mostra o RECORTE (`contexto`) e usa o `nome` como reserva — o nome da
   * tela saiu da barra quando passou a repetir o `h1` da página. Se os dois
   * viessem vazios, o canto esquerdo ficaria em branco, que é exatamente o
   * defeito do breadcrumb órfão com outra roupa.
   *
   * Por isso o teste varre as rotas com e sem sessão: **nunca os dois vazios**.
   */
  it('nunca deixa o canto vazio: contexto ou, na falta dele, o nome', () => {
    const rotas = [
      '/painel',
      '/reuniao',
      '/reuniao-n3',
      '/acoes',
      '/pontos-causa',
      '/admin',
      '/contramedida/AC-0311',
      '/indicador/vendas/NOR',
      '/rota-que-nao-existe',
      '/',
    ]
    for (const rota of rotas) {
      for (const quem of [n2, n4, { nivel: null, filial: null }]) {
        const t = tituloDaTela(rota, quem, null)
        expect(t.contexto || t.nome, `${rota} sem nada a mostrar`).not.toBe('')
      }
    }
  })

  /**
   * O NÍVEL VEM DA ROTA — o título descreve a TELA, não quem a abre.
   *
   * Defeito pego no QA de 12/09/2026: um N3 abrindo o quadro do N4 via
   * `GD N3` sobre a reunião do adjunto. `/reuniao` é o quadro do N4 seja quem
   * for que entre nele.
   */
  it('o quadro manda no nível, mesmo quando quem olha é de outro', () => {
    const n3 = { nivel: 'N3' as const, filial: 'NOR' }
    expect(tituloDaTela('/reuniao', n3, null).contexto).toBe('GD N4 · Gerência adjunta · NOR')
    expect(tituloDaTela('/painel', n3, null).contexto).toBe(
      'GD N2 · Diretoria e Gerência Corporativa · NOR',
    )
  })

  /*
   * E nas telas PESSOAIS quem manda é quem olha: `/acoes` e o detalhe de uma
   * contramedida mostram o que passou pela SUA mão (§7.70), não um quadro.
   */
  it('nas telas pessoais o nível é o de quem olha', () => {
    expect(tituloDaTela('/acoes', n4, null).contexto).toBe('GD N4 · Gerência adjunta · NOR')
    expect(tituloDaTela('/contramedida/AC-0311', n2, null).contexto).toBe(
      'GD N2 · Diretoria e Gerência Corporativa',
    )
  })

  it('sem sessão, a rota do quadro ainda sabe o nível; a pessoal cai no nome', () => {
    expect(tituloDaTela('/painel', { nivel: null, filial: null }, null).contexto).toBe(
      'GD N2 · Diretoria e Gerência Corporativa',
    )

    const pessoal = tituloDaTela('/acoes', { nivel: null, filial: null }, null)
    expect(pessoal.contexto).toBe('')
    expect(pessoal.nome).toBe('Ações')
  })

  /*
   * "GD" na frente porque a barra fala do QUADRO, não do cargo de quem entrou
   * — a barra navy acima já diz quem é a pessoa. E o N2 não é só a diretoria:
   * os perfis mapeados nele incluem gerências corporativas.
   */
  it('o contexto diz de qual GD é a tela, com o nível e a loja', () => {
    expect(tituloDaTela('/painel', n2, null).contexto).toBe(
      'GD N2 · Diretoria e Gerência Corporativa',
    )
    expect(tituloDaTela('/reuniao', n4, null).contexto).toBe('GD N4 · Gerência adjunta · NOR')
  })

  /**
   * A VISÃO VENCE O CADASTRO — a mesma escolha de `quadroDoNivel` e do bloco de
   * ações do N4.
   *
   * Com uma visão simulada a tela é a de outro nível, e o cabeçalho tem de
   * dizer a mesma coisa que a faixa laranja diz dois centímetros abaixo. Dizer
   * o cadastro ali seria descrever a PESSOA em vez da TELA.
   */
  it('com visão simulada, o contexto é o da visão', () => {
    const t = tituloDaTela('/reuniao-n3', n2, {
      nivel: 'N3',
      filial: 'CEN',
      gerencia: null,
    })
    expect(t.contexto).toBe('GD N3 · Gerência geral · CEN')
  })

  it('a gerência entra quando a visão a tem', () => {
    const t = tituloDaTela('/reuniao', n2, {
      nivel: 'N4',
      filial: 'NOR',
      gerencia: 'Construção',
    })
    expect(t.contexto).toBe('GD N4 · Gerência adjunta · NOR · Construção')
  })
})

/**
 * O GD NO TÍTULO — o recorte do N4 não dizia de qual Gerenciamento Diário era.
 *
 * `GD N4 · Gerência adjunta · NOR` diz o nível, o cargo e a loja. No N3 a
 * fileira de abas responde "qual GD"; no N4 não havia abas — a tela nunca
 * publicou as dela —, e o pedaço mais importante para quem está na reunião
 * ficava de fora.
 *
 * Cheguei a pôr a GERÊNCIA aqui, lendo o pedido como "de quem é esta tela". O
 * analista corrigiu: *"o nome do gd que eu queria era o nome principal,
 * vendas"*.
 */
describe('o GD no título', () => {
  const adjunto = { nivel: 'N4' as const, filial: 'NOR' }

  it('entra como último pedaço do recorte', () => {
    expect(tituloDaTela('/reuniao', adjunto, null, 'Vendas').contexto).toBe(
      'GD N4 · Gerência adjunta · NOR · Vendas',
    )
  })

  /*
   * Sem GD o pedaço SOME, e é isso que faz a mesma função servir às oito rotas
   * sem um `if` por tela: quem não publica GD nenhum chama com três argumentos.
   */
  it('sem GD, o título não ganha separador sobrando', () => {
    expect(tituloDaTela('/reuniao', adjunto, null).contexto).toBe(
      'GD N4 · Gerência adjunta · NOR',
    )
    expect(tituloDaTela('/acoes', adjunto, null, null).contexto).toBe(
      'GD N4 · Gerência adjunta · NOR',
    )
  })

  /* A visão continua mandando no resto do recorte, com ou sem GD. */
  it('convive com a visão simulada', () => {
    const t = tituloDaTela(
      '/reuniao',
      adjunto,
      { nivel: 'N4', filial: 'CEN', gerencia: null },
      'Vendas',
    )
    expect(t.contexto).toBe('GD N4 · Gerência adjunta · CEN · Vendas')
  })
})
