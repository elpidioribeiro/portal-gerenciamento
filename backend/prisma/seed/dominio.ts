import type { PrismaClient } from '@prisma/client'
import { FILIAIS } from './dados-handoff.js'

/**
 * Filiais, buckets do GD e pessoas.
 *
 * Buckets são cadastro próprio do portal — não têm relação com dim_area_venda /
 * dim_linha, que servem ao detalhe de vendas.
 */

const BUCKETS = [
  /*
   * N4 — a GERÊNCIA. É o quadro do coordenador, e ele tem um só.
   *
   * O handoff trazia estes agrupamentos com DOIS níveis empilhados numa linha
   * só: `grupo` era a gerência (Vendas Construção, Operacional) e `nome` era a
   * área dentro dela (Pisos e Revestimentos, Recebimento). Isso fazia o N4
   * escolher, ao abrir uma ação, entre "Pisos e Revestimentos" e "Eletro" --
   * mas o quadro dele não é o da área, é o da gerência inteira.
   *
   * A área de venda é a camada de BAIXO, e ela é do N5, que ainda não existe
   * (analista, 29/08/2026). Quando existir, ela volta como agrupamento daquele
   * nível -- não como um segundo eixo espremido neste.
   *
   * `grupo` fica nulo, como nos outros níveis: não há mais nada acima.
   */
  { nivel: 'N4', grupo: null, nome: 'Construção' },
  { nivel: 'N4', grupo: null, nome: 'Não Construção' },
  { nivel: 'N4', grupo: null, nome: 'Operacional' },

  /*
   * N3 e N2 — O AGRUPAMENTO É O GD, e não um tema escolhido à mão.
   *
   * A lista antiga (Vendas, Operacional, Pessoas, Perdas e Despesas) veio do
   * protótipo do handoff e era um VOCABULÁRIO PARALELO: só "Vendas" coincidia
   * com um GD, "Pessoas" não era GD nenhum, e uma ação nascida de uma causa de
   * NPS não tinha para onde ir. Como a etiqueta destes dois níveis passou a ser
   * deduzida do GD do ponto de causa (§ `criacaoExigeAgrupamento`), a lista
   * precisava ser a mesma dos indicadores -- senão a dedução não teria alvo.
   *
   * Os nomes acompanham `prisma/seed/indicadores.ts`. Mudar um lá sem mudar
   * aqui faz a dedução falhar e cair em "Geral", que é visível na tela --
   * barulhento de propósito, em vez de silencioso.
   *
   * **"Geral" é a saída de quem não marcou causa.** Marcar é opcional em N2 e
   * N3 (decisão do analista, 11/09/2026), e sem causa não há GD. Carimbar a
   * ação num GD que ninguém escolheu seria inventar dado; deixar a coluna vazia
   * não dá, porque é ela que monta as colunas da lista de ações. "Geral" diz a
   * verdade: esta ação não está pendurada em nenhum GD.
   */
  { nivel: 'N3', grupo: null, nome: 'Vendas' },
  { nivel: 'N3', grupo: null, nome: 'NPS' },
  { nivel: 'N3', grupo: null, nome: 'Perdas % Mov' },
  { nivel: 'N3', grupo: null, nome: 'Custo' },
  { nivel: 'N3', grupo: null, nome: 'Geral' },

  { nivel: 'N2', grupo: null, nome: 'Vendas' },
  { nivel: 'N2', grupo: null, nome: 'NPS' },
  { nivel: 'N2', grupo: null, nome: 'Perdas % Mov' },
  { nivel: 'N2', grupo: null, nome: 'Custo' },
  { nivel: 'N2', grupo: null, nome: 'Geral' },

  // CROSS — setores de apoio
  { nivel: 'CROSS', grupo: null, nome: 'Suprimentos' },
  { nivel: 'CROSS', grupo: null, nome: 'Comercial' },
  { nivel: 'CROSS', grupo: null, nome: 'Manutenção' },
  { nivel: 'CROSS', grupo: null, nome: 'Gente e Gestão' },
  { nivel: 'CROSS', grupo: null, nome: 'Tecnologia' },
  { nivel: 'CROSS', grupo: null, nome: 'Financeiro' },

  /*
   * N1 e N5 saíram em 24/08/2026 — a hierarquia atendida vai de N4 a N2.
   *
   * O agrupamento "Vice-presidência" (N1) era o único registro desses dois
   * níveis em todo o banco. Os valores continuam no enum `nivel_type`, e isso
   * é deliberado: em Postgres não se remove valor de enum, recria-se o tipo e
   * reescreve-se cada uma das seis colunas que o usam. Como a ausência é "por
   * enquanto", pagar uma migração de tipo para desfazê-la depois seria caro nas
   * duas direções.
   */
] as const

/**
 * Elenco do handoff. `Marcos Leite` é o usuário de teste (N2, o perfil que a
 * v1 atende).
 */
const PESSOAS = [
  // Marcos Leite carrega um id_perfil real (342, Diretor de Operações
  // Corporativo) para que o usuário padrão de desenvolvimento exercite o
  // caminho de verdade: resolução do nível via perfil_nivel, e não o
  // fallback do cadastro. Os demais ficam sem id_perfil enquanto os valores
  // de N3 e N4 não chegam — assim os dois caminhos ficam cobertos.
  { login: 'f00001mle', nome: 'Marcos Leite', nivel: 'N2', cargo: 'Diretoria Operações', bucket: 'Geral', idPerfil: 342 },
  { login: 'f00002hbr', nome: 'Helena Braga', nivel: 'N2', cargo: 'Diretoria Comercial', bucket: 'Vendas' },
  { login: 'f00003opi', nome: 'Otávio Pires', nivel: 'N2', cargo: 'Diretoria Pessoas', bucket: 'Geral' },

  { login: 'f00004ffr', nome: 'Felipe Freitas', nivel: 'N3', cargo: 'Gerência geral', bucket: 'Geral' },
  { login: 'f00005rdu', nome: 'Rafael Duarte', nivel: 'N3', cargo: 'Gerente geral NOR', bucket: 'Geral', filial: 'NOR' },
  { login: 'f00006man', nome: 'Marina Andrade', nivel: 'N3', cargo: 'Gerente geral CEN', bucket: 'Geral', filial: 'CEN' },

  { login: 'f00007svi', nome: 'Sandra Vieira', nivel: 'N4', cargo: 'Coordenação Operacional', bucket: 'Operacional' },
  { login: 'f00008tba', nome: 'Tiago Barros', nivel: 'N4', cargo: 'Encarregado de perecíveis', bucket: 'Operacional', filial: 'NOR' },
  { login: 'f00009jnu', nome: 'João Nunes', nivel: 'N4', cargo: 'Encarregado de salão', bucket: 'Não Construção', filial: 'CEN' },
  { login: 'f00010pli', nome: 'Paulo Lima', nivel: 'N4', cargo: 'Coordenador de logística', bucket: 'Operacional' },

  { login: 'f00011afr', nome: 'Ana Freitas', nivel: 'CROSS', cargo: 'Suprimentos', bucket: 'Suprimentos' },
  { login: 'f00012lca', nome: 'Lucas Campos', nivel: 'CROSS', cargo: 'Comercial', bucket: 'Comercial' },
  { login: 'f00013pso', nome: 'Pedro Souza', nivel: 'CROSS', cargo: 'Manutenção', bucket: 'Manutenção' },
  { login: 'f00014cro', nome: 'Camila Rocha', nivel: 'CROSS', cargo: 'Gente e Gestão', bucket: 'Gente e Gestão' },
  { login: 'f00015bal', nome: 'Bruno Alves', nivel: 'CROSS', cargo: 'Tecnologia', bucket: 'Tecnologia' },
  { login: 'f00016tme', nome: 'Tatiana Melo', nivel: 'CROSS', cargo: 'Financeiro', bucket: 'Financeiro' },
] as const

/** "Marcos Leite" → "ML". Duas iniciais, como no handoff (avatar 34px). */
function iniciaisDe(nome: string): string {
  const partes = nome.split(' ').filter(Boolean)
  const primeira = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
}

export async function semearDominio(prisma: PrismaClient, senhaHash: string) {
  // Filiais reais + as duas pseudo-filiais que o handoff usa:
  // "Rede" aparece como escopo de contramedida; "99-CORPORATIVO" é opção de login.
  const filiais = new Map<string, string>()

  for (const [i, f] of FILIAIS.entries()) {
    const r = await prisma.filial.upsert({
      where: { sigla: f.sigla },
      // `codigo` nos DOIS ramos: no update também, senão uma filial que já
      // existia sem código continuaria sem ele, e o upsert deixaria de convergir
      // para o estado pretendido.
      update: { nome: f.nome, codigo: f.codigo, ordem: i + 1 },
      create: { sigla: f.sigla, nome: f.nome, codigo: f.codigo, tipo: 'FILIAL', ordem: i + 1 },
    })
    filiais.set(f.sigla, r.id)
  }

  for (const extra of [
    { sigla: 'Rede', nome: 'Rede', tipo: 'REDE' as const, ordem: 90 },
    { sigla: '99-CORPORATIVO', nome: 'Corporativo', tipo: 'CORPORATIVO' as const, ordem: 99 },
  ]) {
    const r = await prisma.filial.upsert({
      where: { sigla: extra.sigla },
      update: {},
      create: extra,
    })
    filiais.set(extra.sigla, r.id)
  }

  // Buckets — a chave natural é (nivel, nome); o mesmo nome existe em N2 e N3.
  const buckets = new Map<string, string>()
  for (const [i, b] of BUCKETS.entries()) {
    const r = await prisma.bucket.upsert({
      where: { nivel_nome: { nivel: b.nivel, nome: b.nome } },
      update: { grupo: b.grupo, ordem: i + 1 },
      create: { nivel: b.nivel, grupo: b.grupo, nome: b.nome, ordem: i + 1 },
    })
    buckets.set(`${b.nivel}|${b.nome}`, r.id)
  }

  // Pessoas
  const pessoas = new Map<string, string>()
  for (const p of PESSOAS) {
    const bucketId = buckets.get(`${p.nivel}|${p.bucket}`)
    if (!bucketId) throw new Error(`Bucket ${p.nivel}|${p.bucket} não existe (pessoa ${p.nome})`)

    // `?? null` explícito: Map.get devolve `undefined`, e com
    // exactOptionalPropertyTypes o Prisma não aceita `undefined` onde a coluna
    // é nullable — são coisas diferentes ("não informado" vs "sem filial").
    const filialId = 'filial' in p ? (filiais.get(p.filial) ?? null) : null
    if ('filial' in p && !filialId) throw new Error(`Filial ${p.filial} não existe (pessoa ${p.nome})`)

    const idPerfil = 'idPerfil' in p ? p.idPerfil : null

    const r = await prisma.usuario.upsert({
      where: { loginErp: p.login },
      update: { nome: p.nome, cargo: p.cargo, nivel: p.nivel, bucketId, filialId, idPerfil },
      create: {
        loginErp: p.login,
        nome: p.nome,
        iniciais: iniciaisDe(p.nome),
        cargo: p.cargo,
        nivel: p.nivel,
        idPerfil,
        bucketId,
        filialId,
        senhaHash,
      },
    })
    pessoas.set(p.nome, r.id)
  }

  return { filiais, buckets, pessoas }
}
