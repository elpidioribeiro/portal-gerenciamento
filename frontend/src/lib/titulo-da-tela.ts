import type { NivelAcao } from './api.js'
import { ROTULO_NIVEL } from './rotulos.js'

/**
 * O NOME DA TELA, para o canto esquerdo do cabeçalho.
 *
 * Ali morava um breadcrumb, e ele tinha **um item só em cinco das oito rotas**:
 * `/painel`, `/reuniao`, `/reuniao-n3`, `/acoes` e `/pontos-causa` mostravam
 * apenas "Painel GD". Trilha de um item não é trilha — é um rótulo com cara de
 * link, ocupando o canto esquerdo enquanto o meio da barra fica vazio. E o que
 * ele apontava (o quadro do nível) já era o destino da aba "Indicadores", ao
 * lado: o clique existia em dois lugares e o rótulo em um.
 *
 * Trocado pelo NOME DA TELA em duas linhas, com a mesma anatomia da faixa de
 * identidade das reuniões (contexto em cima, nome embaixo) — decisão do
 * analista em 12/09/2026, escolhendo a direção B entre três desenhadas.
 *
 * **Por rota, e não por contexto publicado pela tela.** Um `TituloContext` que
 * cada tela alimentasse seria mais flexível e teria um custo real: o cabeçalho
 * passaria a depender de oito telas lembrarem de se anunciar, e a que
 * esquecesse ficaria com o canto vazio — sem erro, sem aviso. Aqui, rota nova
 * sem entrada cai no nome do portal, que é feio mas nunca vazio.
 *
 * O CONTEXTO (a linha de cima) vem da sessão e da visão, que o cabeçalho já lê.
 * Ele não sabe quantas filiais o painel carregou, então diz o nível e o recorte
 * — que é o que não muda de tela para tela.
 */
export interface TituloDaTela {
  /** O recorte inteiro, já unido — o que os testes fixam. */
  contexto: string
  /**
   * As MESMAS partes, separadas, para o cabeçalho tipografá-las.
   *
   * A barra dá peso ao primeiro pedaço (`GD N2`) e deixa o resto leve: o nível
   * é o que se procura, e o cargo por extenso é a explicação dele. Unido num
   * `<span>` só, o título virava um bloco pesado -- e em negrito inteiro não
   * havia hierarquia nenhuma dentro dele.
   */
  partes: string[]
  /** O nome, em 15px bold. Nunca vazio. */
  nome: string
}

/**
 * O NÍVEL DE CADA QUADRO — porque o título descreve a TELA, não quem a abre.
 *
 * Defeito pego no QA de 12/09/2026: um N3 abrindo o quadro do N4 via
 * `GD N3 · Gerência geral · NOR` sobre a reunião do adjunto. O título vinha do
 * cadastro de quem olhava, e `/reuniao` é o quadro do N4 seja quem for que
 * entre nele — é exatamente por isso que a faixa antiga daquela tela cravava
 * "N4", com o mesmo argumento escrito ao lado: *"ler o nível efetivo aqui
 * descreveria quem OLHA, e não o que está sendo olhado"*.
 *
 * As rotas PESSOAIS ficam de fora de propósito: `/acoes`, `/pontos-causa` e o
 * detalhe de uma contramedida não são quadro de nível nenhum — mostram o que
 * passou pela SUA mão (§7.70). Lá o nível de quem olha é o certo.
 */
const NIVEL_DA_ROTA: Record<string, NivelAcao> = {
  painel: 'N2',
  'reuniao-n3': 'N3',
  reuniao: 'N4',
}

/** Nome por rota. A chave é o primeiro segmento; ver `tituloDaTela`. */
const NOMES: Record<string, string> = {
  painel: 'Reunião diária',
  reuniao: 'Reunião diária',
  'reuniao-n3': 'Reunião diária',
  acoes: 'Ações',
  'pontos-causa': 'Pontos de causa',
  contramedida: 'Contramedida',
  indicador: 'Desdobramento',
  admin: 'Administração',
  fechamento: 'Fechamento de custo',
}

export function tituloDaTela(
  caminho: string,
  quem: { nivel: NivelAcao | null; filial: string | null },
  visao: { nivel: string; filial: string | null; gerencia: string | null } | null,
  /**
   * O GD da tela — `Vendas`, `NPS`, `Perdas % Mov`, `Custo`.
   *
   * Vem de FORA porque quem sabe é a TELA, e não a rota nem a sessão: a reunião
   * do N4 é a de uma gerência, e a gerência pertence a um GD.
   *
   * **Só quando há UM.** Com vários, quem diz é a fileira de abas ao lado do
   * título, e repetir o ativo aqui seria a mesma informação duas vezes na mesma
   * barra — o incômodo que o analista apontou em 12/09, e que a regra "cada
   * coisa é dita uma vez, no lugar que é dono dela" resolveu.
   *
   * Último parâmetro e opcional de propósito: as sete telas que não têm GD
   * continuam chamando com três argumentos.
   */
  gd: string | null = null,
): TituloDaTela {
  const segmentos = caminho.split('/').filter(Boolean)
  const raiz = segmentos[0] ?? ''

  /*
   * O SEGUNDO SEGMENTO entra no nome quando ele É a identidade da tela: o
   * código da ação e o par indicador/filial do desdobramento. Nas outras rotas
   * não há segundo segmento, e inventar um faria o nome mudar sozinho.
   */
  const nome =
    raiz === 'contramedida' && segmentos[1]
      ? decodeURIComponent(segmentos[1])
      : raiz === 'indicador' && segmentos[1] && segmentos[2]
        ? `${decodeURIComponent(segmentos[1])} · ${decodeURIComponent(segmentos[2])}`
        : (NOMES[raiz] ?? 'Portal GD')

  /*
   * O recorte em vigor, e não o cadastro de quem entrou: com uma visão
   * simulada, a tela é a de outro nível, e o cabeçalho tem de dizer a mesma
   * coisa que a faixa laranja diz logo abaixo. É a mesma escolha que
   * `quadroDoNivel` e o bloco de ações do N4 já fazem.
   */
  /*
   * A ROTA primeiro, a visão depois, o cadastro por último. A filial continua
   * vindo da visão ou de quem olha: o quadro é do N4, mas de QUAL loja é o
   * recorte em vigor que diz.
   */
  const nivel = NIVEL_DA_ROTA[raiz] ?? visao?.nivel ?? quem.nivel
  const filial = visao ? visao.filial : quem.filial

  /**
   * O GD FECHA O RECORTE, e ele faltava justamente no N4.
   *
   * `GD N4 · Gerência adjunta · NOR` diz o nível, o cargo e a loja, e não diz
   * de QUAL Gerenciamento Diário aquela reunião é. No N3 a fileira de abas
   * responde; no N4 não havia abas, porque a tela nunca publicou as dela — e o
   * recorte ficava sem o pedaço mais importante para quem está na reunião.
   *
   * Cheguei a pôr a GERÊNCIA aqui, lendo o pedido como "de quem é esta tela".
   * O analista corrigiu: *"o nome do gd que eu queria era o nome principal,
   * vendas"*. A gerência já está nas abas da própria tela; o GD não estava em
   * lugar nenhum.
   */

  /*
   * "GD" NA FRENTE, e isto é o que a barra está dizendo: o Gerenciamento
   * Diário DAQUELE nível. Sem o prefixo, "N2 · Diretoria e Gerência
   * Corporativa" lia como o cargo de quem está logado, e não como o quadro que
   * está na tela -- e a barra navy logo acima já diz quem é a pessoa.
   */
  const partes = [
    nivel === null ? null : `GD ${nivel}`,
    nivel === null ? null : ROTULO_NIVEL[nivel],
    filial,
    /*
     * A GERÊNCIA DA VISÃO continua, e o GD entra DEPOIS dela.
     *
     * São coisas diferentes e as duas fazem parte do recorte: a gerência diz
     * QUAL quadro dentro da loja, o GD diz de qual Gerenciamento Diário ele é.
     * Tirei a gerência ao trocar o pedaço pelo GD, e a suíte pegou -- ela já
     * aparecia com visão simulada desde 12/09, com teste.
     *
     * Só aparece simulando: é a única situação em que a gerência da tela não é
     * a de quem olha, e por isso precisa ser dita.
     */
    visao?.gerencia ?? null,
    gd,
  ]
    .filter((p): p is string => Boolean(p))

  return { contexto: partes.join(' · '), partes, nome }
}
