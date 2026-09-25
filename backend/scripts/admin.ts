import { PrismaClient } from '@prisma/client'
import { consultarUma, encerrarOracle } from '../src/lib/oracle.js'
import { ehAdmin } from '../src/modules/auth/papel-admin.js'

/**
 * Concede ou revoga `admin` para uma matrícula.
 *
 * É script e não endpoint de propósito: o **primeiro** administrador não pode
 * nascer pela API, porque toda rota de `/admin` exige um administrador já
 * existente. Um endpoint público de auto-promoção resolveria o ovo e a galinha
 * abrindo a porta para qualquer um.
 *
 * Quem já é administrador não precisa disto para criar o segundo — mas essa
 * rota ainda não existe, e enquanto não existir, este script é o caminho.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/admin.ts conceder 10001 u10001abc
 *   npx tsx --env-file=.env scripts/admin.ts revogar   10001
 *   npx tsx --env-file=.env scripts/admin.ts listar
 *
 * O terceiro argumento é o `login_erp` completo. Vale informá-lo: o formato é
 * `f` + matrícula + duas letras que **não estão na view do RH**, e sem ele o
 * cadastro fica com o login incompleto. O primeiro login real então não
 * encontraria este usuário e criaria um segundo cadastro — com o `admin` no
 * registro errado.
 */

const prisma = new PrismaClient()

interface DoOracle {
  ID_PERFIL: number | null
  NOME: string
  CARGO: string
  NOMLOC: string
  COD_EMPRESA: number
}

/**
 * Busca a pessoa na view do RH pela matrícula.
 *
 * `numcad` e não `cd_usuario`: a matrícula que a pessoa informa é o `numcad` da
 * view. A tradução via `hr_usuario_filiais` é necessária no LOGIN, onde a chave
 * que chega é o `cd_usuario` do sistema de acesso — aqui a matrícula vem da mão
 * de quem roda o script, e é o numcad.
 *
 * `TRIM` em tudo: os campos da view vêm com espaço à direita. Ver
 * `modules/admin/perfis-oracle.ts`.
 */
async function buscarNoRh(matricula: number): Promise<DoOracle | null> {
  return consultarUma<DoOracle>(
    `SELECT id_perfil AS ID_PERFIL,
            TRIM(nomfun) AS NOME,
            TRIM(titred) AS CARGO,
            TRIM(nomloc) AS NOMLOC,
            cod_empresa AS COD_EMPRESA
       FROM hr_vw_colaboradores
      WHERE numcad = :matricula AND sitafa = 1`,
    { matricula },
  )
}

/**
 * Monta o `login_erp` no formato do sistema de acesso: `f` + matrícula + duas
 * letras. As duas letras finais variam por pessoa e não estão na view, então a
 * busca é por prefixo — e uma correspondência ambígua é erro, não escolha.
 */
async function acharUsuario(matricula: number) {
  const candidatos = await prisma.usuario.findMany({
    where: { OR: [{ loginErp: { startsWith: `f${matricula}` } }, { idPerfil: null }] },
  })

  const porLogin = candidatos.filter((u) => u.loginErp.startsWith(`f${matricula}`))
  if (porLogin.length > 1) {
    throw new Error(
      `Mais de um usuário começa com "f${matricula}": ${porLogin.map((u) => u.loginErp).join(', ')}. ` +
        'Ajuste na mão para não promover o errado.',
    )
  }
  return porLogin[0] ?? null
}

async function conceder(matricula: number, login?: string) {
  if (login !== undefined && !login.startsWith(`f${matricula}`)) {
    throw new Error(
      `O login "${login}" não começa com "f${matricula}". Se estiver certo mesmo, ajuste na mão ` +
        '— a divergência entre login e matrícula é o tipo de erro que promove a pessoa errada.',
    )
  }

  const rh = await buscarNoRh(matricula)
  if (!rh) {
    throw new Error(
      `A matrícula ${matricula} não está na view do RH como trabalhando (sitafa = 1). ` +
        'Confira o número — promover matrícula errada dá acesso de administrador a outra pessoa.',
    )
  }

  console.log(`  RH: ${rh.NOME} · ${rh.CARGO} · ${rh.NOMLOC} · empresa ${rh.COD_EMPRESA}`)
  console.log(`  id_perfil: ${rh.ID_PERFIL ?? '(nenhum)'}`)

  const existente = await acharUsuario(matricula)

  if (existente) {
    // Completar o login é parte do trabalho, não efeito colateral: um cadastro
    // com login incompleto é invisível para o login real.
    const precisaCorrigir = login !== undefined && login !== existente.loginErp
    if (ehAdmin(existente) && !precisaCorrigir) {
      console.log(`\n  ${existente.loginErp} já é administrador. Nada a fazer.`)
      return
    }
    const u = await prisma.usuario.update({
      where: { id: existente.id },
      data: { papelAdmin: 'ADMIN', ...(login === undefined ? {} : { loginErp: login }) },
    })
    console.log(
      `\n  ${u.loginErp} agora é administrador.${precisaCorrigir ? ` (login corrigido de "${existente.loginErp}")` : ''}`,
    )
    return
  }

  /**
   * Usuário ainda não existe no portal.
   *
   * Acontece porque o cadastro nasce no primeiro login pela API da ERP, e o
   * administrador precisa existir ANTES — é ele que classifica os perfis que
   * fazem o login funcionar. Sem esta criação, a ordem seria impossível.
   *
   * `senhaHash` fica nulo: quem autentica é a API corporativa, não o portal.
   * Enquanto o `AUTH_PROVIDER` for `mock`, este usuário não consegue logar por
   * senha — e não deve, porque senha do portal para conta corporativa seria uma
   * segunda credencial para a mesma pessoa.
   *
   * `nivel` recebe o do `perfil_nivel` se o perfil já estiver classificado; se
   * não, N2 — porque o administrador tem de conseguir entrar para classificar. É
   * o único lugar do sistema onde um nível é atribuído sem passar pela tabela, e
   * está aqui em vez de no código do login justamente para não ser regra geral.
   */
  const classificacao = rh.ID_PERFIL
    ? await prisma.perfilNivel.findUnique({ where: { idPerfil: rh.ID_PERFIL } })
    : null

  const iniciais = rh.NOME.split(/\s+/)
    .filter((p) => p.length > 2)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

  const criado = await prisma.usuario.create({
    data: {
      loginErp: login ?? `f${matricula}`,
      nome: rh.NOME,
      iniciais: iniciais || 'AD',
      cargo: rh.CARGO,
      idPerfil: rh.ID_PERFIL,
      nivel: classificacao?.nivel ?? 'N2',
      papelAdmin: 'ADMIN',
      senhaHash: null,
    },
  })

  console.log(`\n  Criado ${criado.loginErp} como administrador, nível ${criado.nivel}.`)
  if (!classificacao) {
    console.log(
      `  ATENÇÃO: o perfil ${rh.ID_PERFIL ?? '(nenhum)'} não está classificado. O nível N2 foi\n` +
        '  atribuído direto para você conseguir entrar e classificar. Classifique o seu\n' +
        '  próprio perfil pela tela de administração — enquanto não classificar, a\n' +
        '  resolução de nível a cada requisição vai recusar o login.',
    )
  }
  if (login === undefined) {
    console.log(
      `\n  O login_erp ficou "f${matricula}", SEM as duas letras finais que o sistema de\n` +
        '  acesso acrescenta — elas não estão na view do RH. Rode de novo passando o login\n' +
        '  completo como terceiro argumento antes de ligar AUTH_PROVIDER=erp: senão o\n' +
        '  primeiro login não acha este cadastro e cria um segundo, sem o admin.',
    )
  }
}

async function revogar(matricula: number) {
  const u = await acharUsuario(matricula)
  if (!u) throw new Error(`Nenhum usuário do portal com matrícula ${matricula}.`)
  if (!ehAdmin(u)) {
    console.log(`  ${u.loginErp} não é administrador. Nada a fazer.`)
    return
  }

  /**
   * Revogar o último administrador deixa a área de administração inacessível
   * pela aplicação — e é a área que classifica perfis, sem a qual ninguém entra
   * quando o login real estiver ligado. Recuperar exige rodar este script de
   * novo, o que só é possível com acesso ao servidor.
   */
  const quantos = await prisma.usuario.count({ where: { papelAdmin: 'ADMIN', ativo: true } })
  if (quantos <= 1) {
    throw new Error(
      `${u.loginErp} é o único administrador ativo. Revogar deixa a administração ` +
        'inacessível pela aplicação. Conceda a outra pessoa primeiro.',
    )
  }

  await prisma.usuario.update({ where: { id: u.id }, data: { papelAdmin: 'NENHUM' } })
  console.log(`  ${u.loginErp} não é mais administrador.`)
}

async function listar() {
  const admins = await prisma.usuario.findMany({
    where: { papelAdmin: 'ADMIN' },
    orderBy: { loginErp: 'asc' },
  })
  if (admins.length === 0) {
    console.log('  Nenhum administrador. A área de administração está inacessível.')
    return
  }
  console.log(`  ${admins.length} administrador(es):`)
  for (const a of admins) {
    console.log(
      `    ${a.loginErp.padEnd(14)} ${a.nome.padEnd(30)} ${a.nivel} · perfil ${a.idPerfil ?? '-'}${a.ativo ? '' : ' (INATIVO)'}`,
    )
  }
}

async function main() {
  const [comando, arg, login] = process.argv.slice(2)

  if (comando === 'listar') return listar()

  if (comando !== 'conceder' && comando !== 'revogar') {
    throw new Error(
      'Uso: npx tsx --env-file=.env scripts/admin.ts <conceder|revogar|listar> [matricula]',
    )
  }

  const matricula = Number(arg)
  if (!Number.isInteger(matricula) || matricula <= 0) {
    throw new Error(`Matrícula inválida: "${arg ?? ''}". Informe o número, ex.: 10001.`)
  }

  if (comando === 'conceder') return conceder(matricula, login)
  return revogar(matricula)
}

main()
  .catch((e: unknown) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await encerrarOracle()
    await prisma.$disconnect()
  })
