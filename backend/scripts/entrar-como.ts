import { PrismaClient } from '@prisma/client'
import { consultarUma, encerrarOracle } from '../src/lib/oracle.js'
import { TRABALHANDO } from '../src/lib/sitafa.js'
import { ehAdmin } from '../src/modules/auth/papel-admin.js'

/**
 * Prepara o portal para entrar COMO outra pessoa, sem a senha dela.
 *
 * Para que serve: conferir a tela de um N4 de verdade — com o perfil, a
 * lotação e a loja que ele tem no RH — sem pedir a senha de ninguém. É o
 * caminho honesto para o teste; o desonesto seria digitar a senha de outro.
 *
 * O que ele faz: lê a pessoa na view do RH pela matrícula e cria (ou atualiza)
 * o cadastro dela no portal. **Não escreve no `.env`** — a chave que liga o
 * bypass fica na sua mão, e o script imprime as duas linhas para colar:
 *
 *     AUTH_DEV_BYPASS=true
 *     AUTH_DEV_USUARIO=<login>
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/entrar-como.ts 7038
 *   npx tsx --env-file=.env scripts/entrar-como.ts 7038 f7038rhs
 *
 * O segundo argumento é o `login_erp` completo, quando você o conhece. Vale
 * informá-lo: o formato é `f` + matrícula + letras que **não estão em lugar
 * nenhum que o portal leia**, e sem ele o cadastro fica com um login de
 * fachada. O primeiro login real da pessoa então não encontraria esta linha e
 * criaria uma segunda — com o teste no registro errado.
 *
 * **O bypass atende QUALQUER requisição como esse usuário, sem senha.** Ele é
 * recusado no boot em produção (`validarEnv`), mas enquanto estiver ligado a
 * sua aplicação local está sem autenticação. Desligue quando terminar.
 */

const prisma = new PrismaClient()

interface DoOracle {
  ID_PERFIL: number | null
  NOME: string
  CARGO: string
  NOMLOC: string
  COD_EMPRESA: number
}

async function principal() {
  const matricula = Number(process.argv[2])
  const loginInformado = process.argv[3]?.trim().toLowerCase()

  if (!Number.isInteger(matricula) || matricula <= 0) {
    throw new Error(
      'Informe a matrícula (numcad). Ex.: npx tsx --env-file=.env scripts/entrar-como.ts 7038',
    )
  }

  /*
   * `numcad` e `sitafa = 1`: a matrícula que a pessoa informa é o numcad da
   * view, e quem está desligado não deveria ser simulado — a tela dele não é
   * um caso de teste, é um cadastro a corrigir.
   */
  const rh = await consultarUma<DoOracle>(
    `SELECT id_perfil AS ID_PERFIL,
            TRIM(nomfun) AS NOME,
            TRIM(titred) AS CARGO,
            TRIM(nomloc) AS NOMLOC,
            cod_empresa AS COD_EMPRESA
       FROM hr_vw_colaboradores
      WHERE numcad = :matricula AND ${TRABALHANDO}`,
    { matricula },
  )

  if (!rh) {
    throw new Error(`Matrícula ${matricula} não está na view do RH, ou está desligada.`)
  }

  /*
   * A filial é a do PERFIL, como no login de verdade. Empresa que não é filial
   * do GD (99, CDs) fica nula — e nula significa "corporativo", não "erro".
   */
  const filial = await prisma.filial.findUnique({ where: { codigo: rh.COD_EMPRESA } })

  /**
   * O NÍVEL é resolvido aqui, e não deixado para a requisição.
   *
   * O bypass entrega o usuário sem passar por `resolverNivelComAcesso` — ele
   * usa o `nivel` GRAVADO. Se esta linha nascesse com um nível qualquer, o
   * teste mostraria uma tela que o login de verdade não mostraria, que é o
   * defeito mais caro de descobrir num ambiente de teste.
   *
   * A precedência é a mesma da resolução: a matrícula vence o perfil.
   */
  const daMatricula = await prisma.matriculaNivel.findUnique({ where: { matricula } })
  const doPerfil = rh.ID_PERFIL
    ? await prisma.perfilNivel.findUnique({ where: { idPerfil: rh.ID_PERFIL } })
    : null

  const classificacao = daMatricula?.ativo ? daMatricula : doPerfil?.ativo ? doPerfil : null
  if (!classificacao) {
    throw new Error(
      `${rh.NOME} tem id_perfil ${String(rh.ID_PERFIL)}, que não está classificado num nível do ` +
        'GD. O login de verdade também recusaria — classifique o perfil na tela de administração ' +
        'antes de simular.',
    )
  }

  const login = loginInformado ?? `f${matricula}`
  const iniciais =
    rh.NOME.split(/\s+/)
      .filter((p) => p.length > 2)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase() || 'XX'

  const dados = {
    nome: rh.NOME,
    iniciais,
    cargo: rh.CARGO,
    idPerfil: rh.ID_PERFIL,
    nomloc: rh.NOMLOC,
    matricula,
    nivel: classificacao.nivel,
    filialId: filial?.id ?? null,
    ativo: true,
  }

  /*
   * `admin` fica de FORA, nos dois lados. Simular alguém não pode conceder
   * administração a quem não tem, nem tirar de quem tem — é decisão do portal,
   * e não do RH.
   */
  /**
   * Casa pela MATRÍCULA, não pelo `login_erp`.
   *
   * Desde a carga de usuários (§7.33) a pessoa pode já existir com um login
   * provisório (`carga:1999`), e a matrícula é `UNIQUE`. Um upsert por
   * `login_erp` não a encontraria, tentaria criar, e esbarraria na unicidade --
   * ou, antes dela existir, criaria a segunda linha que o comentário do topo
   * deste arquivo já temia.
   *
   * É a mesma reconciliação que o login de verdade faz em `auth/provider.ts`.
   */
  const existia = await prisma.usuario.findUnique({ where: { matricula } })
  const usuario = existia
    ? await prisma.usuario.update({
        where: { id: existia.id },
        /*
         * `origemCarga: false` porque a partir daqui a linha tem login próprio
         * e estado próprio -- a carga não pode mais desativá-la numa
         * desclassificação, exatamente como acontece com quem entrou de fato.
         */
        data: { ...dados, loginErp: login, origemCarga: false },
      })
    : await prisma.usuario.create({ data: { loginErp: login, ...dados } })

  const origem = daMatricula?.ativo ? 'matrícula (vence o cargo)' : `id_perfil ${String(rh.ID_PERFIL)}`

  console.log(`
  ${existia ? `Atualizado (existia como ${existia.loginErp})` : 'Criado'}: ${usuario.nome}
  matrícula   ${matricula}
  login_erp   ${login}${loginInformado ? '' : '   ← de fachada; passe o login real como 2º argumento'}
  cargo       ${rh.CARGO} · ${rh.NOMLOC}
  filial      ${filial ? `${filial.sigla} (${String(rh.COD_EMPRESA)})` : `nenhuma — empresa ${String(rh.COD_EMPRESA)} não é filial do GD`}
  nível       ${usuario.nivel}   por ${origem}
  admin       ${ehAdmin(usuario) ? 'sim' : 'não'} (não foi tocado)

  Para entrar como ${rh.NOME.split(' ')[0] ?? ''}, ponha no backend/.env:

      AUTH_DEV_BYPASS=true
      AUTH_DEV_USUARIO=${login}

  e reinicie o backend. ATENÇÃO: com o bypass ligado a aplicação atende
  qualquer requisição como essa pessoa, SEM SENHA. Ele é recusado no boot em
  produção, mas desligue quando terminar o teste.
`)
}

principal()
  .catch((e: unknown) => {
    console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await encerrarOracle()
  })
