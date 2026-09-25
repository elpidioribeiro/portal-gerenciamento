/**
 * Nomes do cadastro corporativo, escritos para serem LIDOS.
 *
 * O RH e o cadastro de cada loja guardam tudo em caixa alta: `CONSTRUÇÃO`,
 * `LOUÇAS E METAIS SANITÁRIOS`, `AGLAIRES MENDES DE SOUSA SANTANA`. Isso é
 * convenção de sistema legado, não decisão de design — e a tela repetia a
 * convenção como se fosse o nome.
 *
 * Caixa alta grita, e uma tela inteira gritando não tem como dar ênfase a nada:
 * quando tudo está em maiúscula, o selo vermelho e o nome da área competem no
 * mesmo volume. Ela também é mais lenta de ler, porque some com a silhueta das
 * palavras — que é justamente o que o olho usa para reconhecê-las sem soletrar.
 *
 * **Só a APRESENTAÇÃO muda.** O que é gravado, comparado e enviado continua
 * exatamente como veio: o casamento entre `dimensao_gerencia.nome` e o
 * agrupamento (§7.28) depende do texto original, e formatar antes de comparar
 * quebraria em silêncio.
 */

/**
 * Partículas que ficam em minúscula no meio do nome.
 *
 * `E` está aqui e é o caso que mais aparece: "LOUÇAS E METAIS" vira "Louças e
 * Metais", não "Louças E Metais". No começo do nome nenhuma delas se aplica —
 * "E Silva" não existe, mas "Da Silva" como sobrenome inicial existe.
 */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na'])

/**
 * Siglas que não são palavras, e viram minúsculas se ninguém as proteger.
 *
 * A lista é curta de propósito. Um detector genérico ("toda palavra de até 3
 * letras é sigla") transformaria "SUL" em "SUL" e "GAB." em "GAB.", mas também
 * quebraria "Rua", "Sul" e qualquer nome curto de verdade — e o custo de errar
 * é um nome errado na tela do quadro.
 */
const SIGLAS = new Set(['cd', 'epi', 'ud', 'tam', 'imb', 'gus', 'aju', 'bar', 'cau', 'jpa', 'pal', 'png'])

/**
 * `NÃO CONSTRUÇÃO` → `Não Construção`, `LOUÇAS E METAIS` → `Louças e Metais`.
 *
 * Preserva o que não é letra — pontos, barras, vírgulas e hifens de
 * `ACES.BANHEIROS, PIAS E GAB. E CONEXÕES` continuam onde estavam, porque a
 * separação é por espaço e o resto do token fica intacto.
 *
 * Texto que **não** está todo em maiúscula passa direto: um nome já escrito
 * como gente escreve ("Pisos e Revestimentos", do seed) não deve ser
 * reprocessado — reprocessar só cria a chance de estragar o que estava certo.
 */
export function nomeLegivel(bruto: string | null | undefined): string {
  if (!bruto) return ''
  const texto = bruto.trim()
  if (texto !== texto.toUpperCase()) return texto

  return texto
    .toLocaleLowerCase('pt-BR')
    .split(/(\s+)/)
    .map((pedaco, i) => {
      if (/^\s+$/.test(pedaco)) return pedaco
      const limpo = pedaco.replace(/[^\p{L}\p{N}]/gu, '')
      if (SIGLAS.has(limpo)) return pedaco.toLocaleUpperCase('pt-BR')
      // `i > 0` porque partícula no INÍCIO do nome é nome, não partícula.
      if (i > 0 && PARTICULAS.has(limpo)) return pedaco
      return maiuscularPrimeira(pedaco)
    })
    .join('')
}

/**
 * Maiúscula na primeira LETRA, e não no primeiro caractere.
 *
 * `(ELÉTRICA)` tem de virar `(Elétrica)`: capitalizar o caractere zero deixaria
 * o parêntese intacto e a letra minúscula.
 */
function maiuscularPrimeira(pedaco: string): string {
  const i = pedaco.search(/\p{L}/u)
  if (i === -1) return pedaco
  return pedaco.slice(0, i) + pedaco[i]!.toLocaleUpperCase('pt-BR') + pedaco.slice(i + 1)
}

/**
 * "1 área" / "2 áreas" — a concordância que os chips do resumo não faziam.
 *
 * Aparecia como **"1 áreas na meta"** nos cabeçalhos do N3 e do N4, que são o
 * primeiro texto que alguém lê na reunião. Erro pequeno e caro: numa tela que
 * pede confiança nos números, a gramática errada é a primeira coisa que a
 * plateia nota.
 *
 * Aqui e não em cada tela porque eram duas cópias do mesmo texto — e é sempre
 * a segunda que fica para trás.
 */
export function areas(n: number): string {
  return n === 1 ? '1 área' : `${n} áreas`
}

/**
 * "1 ação" / "2 ações" — e a razão de existir é pior que a de `areas`.
 *
 * O bloco "O que já está sendo feito", no N3, montava o plural GRUDANDO o
 * sufixo: `ação{n > 1 ? 'ões' : ''}`. Com uma ação dava "1 ação"; com seis
 * dava **"6 açãoões"**. Plural de *-ão* troca a terminação, não acrescenta
 * uma.
 *
 * A palavra saía torta no cabeçalho de um bloco que a reunião lê em voz alta,
 * e é o tipo de erro que faz a plateia duvidar do resto da tela -- se o
 * portal não sabe escrever "ações", por que saberia somar?
 *
 * Junto de `areas` de propósito: a concordância é um problema só, e a próxima
 * contagem que aparecer na tela deve achar o vizinho antes de improvisar.
 */
export function acoes(n: number): string {
  return n === 1 ? '1 ação' : `${n} ações`
}

/**
 * A cor de cada gerência — a faixa do quadro do N4.
 *
 * A cor É informação: numa reunião que troca de gerência com um clique, o fundo
 * mudando junto diz "você está em outro quadro" antes de qualquer texto ser
 * lido. Sem isso, o único sinal de troca é uma palavra de dezessete pixels.
 *
 * **Navy e azul, nunca vermelho ou verde.** Essas duas são exclusivas do farol
 * dos indicadores, e a faixa já foi vermelha em Construção: um quadro inteiro
 * na meta abria com tarja de alarme no topo, e a tinta de "fora da meta"
 * passava a significar também "gerência de obra". Duas coisas na mesma cor, e
 * a que importa é a do farol.
 *
 * Casado por nome NORMALIZADO — sem acento e em caixa alta — porque as duas
 * pontas escrevem diferente: a gerência vem da carga de vendas como
 * "NÃO CONSTRUÇÃO", e um cadastro futuro pode chegar como "Nao Construcao".
 */
const CORES_POR_GERENCIA: Record<string, { destaque: string; tinta: string }> = {
  CONSTRUCAO: { destaque: '#16223D', tinta: 'rgba(22,34,61,.07)' },
  'NAO CONSTRUCAO': { destaque: '#2F5DA8', tinta: 'rgba(47,93,168,.10)' },
}

/**
 * NEUTRO para gerência desconhecida, e não a cor da primeira da lista.
 *
 * Hoje são duas, mas o modelo comporta outras — Operacional é a próxima na
 * conversa. Herdar o navy de Construção pintaria um quadro alheio com a
 * identidade de outro, e ninguém estranharia: a tela ficaria plausível e
 * errada.
 */
const CINZA = { destaque: '#6B7488', tinta: 'rgba(107,116,136,.08)' }

export function coresDaGerencia(nome: string | null | undefined): {
  destaque: string
  tinta: string
} {
  if (!nome) return CINZA
  // `NFD` separa a letra do acento, e a faixa apaga os acentos soltos.
  const chave = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
  return CORES_POR_GERENCIA[chave] ?? CINZA
}
