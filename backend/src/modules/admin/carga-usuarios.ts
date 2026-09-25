import type { Nivel, PrismaClient } from '@prisma/client'
import { consultar } from '../../lib/oracle.js'
import { TRABALHANDO } from '../../lib/sitafa.js'

/**
 * A carga de usuários — o portal conhece as pessoas ANTES do primeiro login.
 *
 * **O problema que ela resolve**, medido em 31/08/2026: `perfil_nivel` tinha
 * `id_perfil 11 → N3` ativo, com dez gerentes gerais de loja no RH, e o seletor
 * de "escalar para o N3" vinha VAZIO. As duas coisas eram verdade ao mesmo
 * tempo, porque `usuario` só ganhava linha no PRIMEIRO LOGIN.
 *
 * É um ovo-e-galinha de implantação: o N4 precisa escalar para o gerente geral,
 * e o gerente geral só virava destino depois de entrar uma vez.
 *
 * **Quando roda:** na hora em que o administrador CLASSIFICA um perfil. Não é
 * job noturno — é o efeito imediato da decisão que acabou de ser tomada na
 * tela, e é assim que o analista pediu: "sempre que eu classificar ou
 * desclassificar os usuários, você muda essa tabela".
 *
 * Ver PLANO §7.33.
 */

/** Uma pessoa, como a view do RH a descreve. */
interface PessoaDoRh {
  matricula: number
  nome: string
  cargo: string | null
  nomloc: string | null
  codEmpresa: number
}

/**
 * As pessoas de um perfil, na view do RH.
 *
 * `TRIM` em tudo: `titred` traz espaço sobrando em 1.239 das 6.061 linhas e
 * `nomloc` em 4 — o padding vem do dado, não da coluna. Sem ele, o `nomloc`
 * gravado aqui não casa com o do login, e a pessoa não vê variável nenhuma sem
 * erro nenhum aparecer (é o item 3 de `perfis-oracle.ts`).
 */
export async function pessoasDoPerfil(idPerfil: number): Promise<PessoaDoRh[]> {
  const { linhas } = await consultar<{
    NUMCAD: number | string
    NOMFUN: string | null
    TITRED: string | null
    NOMLOC: string | null
    COD_EMPRESA: number | string
  }>(
    `SELECT numcad AS NUMCAD, TRIM(nomfun) AS NOMFUN, TRIM(titred) AS TITRED,
            TRIM(nomloc) AS NOMLOC, cod_empresa AS COD_EMPRESA
       FROM hr_vw_colaboradores
      WHERE ${TRABALHANDO}
        AND id_perfil = :idPerfil
      ORDER BY numcad`,
    { idPerfil },
  )

  /*
   * Uma linha por (pessoa, empresa) na origem. Medido em 31/08: das 32 pessoas
   * dos perfis classificados, NENHUMA aparece em mais de uma empresa -- mas a
   * consulta de login já documenta a exceção (1 pessoa em 5.186 tem perfil em
   * duas), e a carga não pode quebrar quando ela aparecer.
   *
   * Fica a PRIMEIRA, pela ordem de `numcad`: é determinístico, e a filial de
   * quem tem duas se corrige no login dela, que sabe por qual loja entrou.
   */
  const porMatricula = new Map<number, PessoaDoRh>()
  for (const l of linhas) {
    const matricula = Number(l.NUMCAD)
    if (porMatricula.has(matricula)) continue
    porMatricula.set(matricula, {
      matricula,
      nome: l.NOMFUN?.trim() ?? `Matrícula ${String(matricula)}`,
      cargo: l.TITRED?.trim() || null,
      nomloc: l.NOMLOC?.trim() || null,
      codEmpresa: Number(l.COD_EMPRESA),
    })
  }
  return [...porMatricula.values()]
}

/**
 * Um `login_erp` provisório, até a pessoa entrar.
 *
 * A view do RH **não tem coluna de login** — as 13 são cod_empresa,
 * centro_custo, numcad, nomfun, titred, codcar, nomloc, numcpf, sitafa, numloc,
 * id_perfil, numfis e avaliador. A carga não tem como produzir `u10001abc`.
 *
 * O prefixo é deliberado, e não decoração: um login inventado que PARECESSE
 * real seria indistinguível no banco, e ninguém saberia que aquela linha ainda
 * espera o primeiro acesso. Mesma razão do `SEED:` em `dimensao_area_venda`.
 */
export function loginProvisorio(matricula: number): string {
  return `carga:${String(matricula)}`
}

export interface ResultadoDaCarga {
  criados: number
  atualizados: number
  /** Estavam desativados pela carga e voltaram: o perfil foi reclassificado. */
  reativados: number
  /** Sem filial correspondente em `filial.codigo` — entram sem loja. */
  semFilial: number
}

/**
 * Cria ou atualiza os usuários de um perfil recém-classificado.
 *
 * **O que ela NUNCA toca em quem já entrou no portal:** `ativo`, `admin` e
 * `login_erp`. Quem tem login próprio tem estado próprio — o `origemCarga`
 * marca a fronteira, e o login o zera no primeiro acesso.
 *
 * O `nivel` é gravado porque a rota de destinatários lê a coluna. Ele continua
 * sendo cache: a resolução de verdade é por `PerfilNivel` a cada requisição
 * (`auth/nivel.ts`), e é justamente por isso que a carga tem de mantê-lo em dia
 * — uma coluna velha aqui faz alguém sumir do seletor sem sumir do portal.
 */
export async function sincronizarUsuariosDoPerfil(
  prisma: PrismaClient,
  idPerfil: number,
  nivel: Nivel,
): Promise<ResultadoDaCarga> {
  const pessoas = await pessoasDoPerfil(idPerfil)
  const r: ResultadoDaCarga = { criados: 0, atualizados: 0, reativados: 0, semFilial: 0 }
  if (pessoas.length === 0) return r

  /*
   * `filial.codigo` é o `cod_empresa`. Buscadas de uma vez: são nove, e uma
   * consulta por pessoa faria 32 idas ao banco para ler a mesma tabela.
   */
  const filiais = await prisma.filial.findMany({ select: { id: true, codigo: true } })
  const filialPorCodigo = new Map(
    filiais.filter((f) => f.codigo !== null).map((f) => [f.codigo!, f.id]),
  )

  const existentes = await prisma.usuario.findMany({
    where: { matricula: { in: pessoas.map((p) => p.matricula) } },
    select: { id: true, matricula: true, origemCarga: true, ativo: true },
  })
  const porMatricula = new Map(existentes.map((u) => [u.matricula!, u]))

  for (const p of pessoas) {
    const filialId = filialPorCodigo.get(p.codEmpresa) ?? null
    if (filialId === null) r.semFilial++

    const atual = porMatricula.get(p.matricula)

    if (!atual) {
      await prisma.usuario.create({
        data: {
          loginErp: loginProvisorio(p.matricula),
          matricula: p.matricula,
          nome: p.nome,
          iniciais: iniciaisDe(p.nome),
          cargo: p.cargo ?? 'Sem cargo no cadastro',
          idPerfil,
          nomloc: p.nomloc,
          nivel,
          filialId,
          origemCarga: true,
        },
      })
      r.criados++
      continue
    }

    /*
     * `ativo` só entra no update de quem a CARGA criou. Em quem já entrou no
     * portal, reativar aqui desfaria uma desativação feita de propósito -- é a
     * mesma razão pela qual o login também deixa `ativo` e `admin` de fora.
     */
    const voltando = atual.origemCarga && !atual.ativo
    await prisma.usuario.update({
      where: { id: atual.id },
      data: {
        nome: p.nome,
        /*
         * Cargo nulo na origem NAO apaga o que ja' esta' gravado: o login le' o
         * `titred` da mesma view, e um dia em que ele vier vazio nao pode
         * esvaziar o cargo de quem ja' entrou.
         */
        ...(p.cargo === null ? {} : { cargo: p.cargo }),
        nomloc: p.nomloc,
        idPerfil,
        nivel,
        filialId,
        ...(atual.origemCarga ? { ativo: true } : {}),
      },
    })
    if (voltando) r.reativados++
    else r.atualizados++
  }

  return r
}

/**
 * Desclassificar um perfil: quem a carga trouxe sai do portal.
 *
 * **Desativa, não apaga.** Duas razões, e a segunda é a que decide:
 *
 *  - é a convenção do schema para aposentar cadastro (`filial.ativa`,
 *    `ponto_causa.ativo`, `indicador.ativo`);
 *  - a pessoa pode já ter ação escalada para ela. Apagar a linha levaria a ação
 *    junto, ou a deixaria sem dono — e uma ação sem dono some do quadro sem
 *    ninguém perceber.
 *
 * **E só mexe em quem a carga criou.** Quem já entrou no portal continua
 * ativo: o login dele será recusado enquanto o perfil não tiver nível (é a
 * regra que já existe), e essa recusa é do login, não desta função. Desativar
 * quem tem histórico seria a carga decidindo sobre gente que ela não trouxe.
 */
export async function desativarUsuariosDoPerfil(
  prisma: PrismaClient,
  idPerfil: number,
): Promise<{ desativados: number; preservados: number }> {
  const [{ count: desativados }, preservados] = await Promise.all([
    prisma.usuario.updateMany({
      where: { idPerfil, origemCarga: true, ativo: true },
      data: { ativo: false },
    }),
    prisma.usuario.count({ where: { idPerfil, origemCarga: false } }),
  ])
  return { desativados, preservados }
}

/**
 * Iniciais para o avatar — as mesmas três letras que o login grava.
 *
 * Primeiro e último nome, ignorando as partículas: "AGLAIRES MENDES DE SOUSA
 * SANTANA" vira `AS`, e não `AD`.
 */
function iniciaisDe(nome: string): string {
  const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E'])
  const partes = nome
    .trim()
    .split(/\s+/)
    .filter((x) => !PARTICULAS.has(x.toUpperCase()))
  if (partes.length === 0) return '??'
  const primeira = partes[0]![0] ?? '?'
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? '') : ''
  return (primeira + ultima).toUpperCase().slice(0, 3)
}
