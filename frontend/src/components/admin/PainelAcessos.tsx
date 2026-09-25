import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type AcessoDoPortal, type PapelAdmin } from '../../lib/api.js'

/**
 * QUEM ADMINISTRA O PORTAL, E QUEM NÃO RECEBE AÇÃO.
 *
 * O quarto cadastro da área. Os três de cima (§7.20) dizem **o que a pessoa
 * vê**; este diz duas coisas que não são nível: o que ela **configura** e se
 * trabalho pode **cair na mão dela**.
 *
 * Até 14/09/2026 isso era `scripts/admin.ts` rodando contra o banco — o que
 * funciona para um administrador e não para vários.
 *
 * **A tela é do MASTER.** Um administrador comum vê a lista e não mexe nela:
 * sem esse degrau, conceder acesso seria transitivo — qualquer admin criaria
 * outro, e revogaria quem o criou.
 */

interface Resposta {
  souMaster: boolean
  acessos: AcessoDoPortal[]
}

const ROTULO_PAPEL: Record<PapelAdmin, string> = {
  NENHUM: 'Não administra',
  ADMIN: 'Administrador',
  MASTER: 'Administrador principal',
}

export function PainelAcessos() {
  const cliente = useQueryClient()
  const [erro, setErro] = useState<string | null>(null)
  const [texto, setTexto] = useState('')

  /*
   * A BUSCA E' COMO ALGUEM NOVO ENTRA. Sem ela a tela lista so' quem ja'
   * administra -- mostra o resultado e nao oferece como chegar nele. Sao ~5 mil
   * pessoas no cadastro, e listar todas para escolher um administrador seria
   * pior do que nao listar nenhuma.
   *
   * Dois caracteres e' o minimo que o servidor aceita: com um, a resposta seria
   * o teto de 30 nomes aleatorios.
   */
  const busca = texto.trim()
  const buscando = busca.length >= 2

  const { data, isPending } = useQuery({
    queryKey: ['admin', 'acessos', buscando ? busca : null],
    queryFn: () =>
      api.get<Resposta>(
        buscando ? `/admin/acessos?busca=${encodeURIComponent(busca)}` : '/admin/acessos',
      ),
    staleTime: 60_000,
  })

  const salvar = useMutation({
    mutationFn: (p: { matricula: number; papelAdmin: PapelAdmin; recebeAcao: boolean }) =>
      api.put(`/admin/acessos/${String(p.matricula)}`, {
        papelAdmin: p.papelAdmin,
        recebeAcao: p.recebeAcao,
      }),
    onSuccess: async () => {
      setErro(null)
      await cliente.invalidateQueries({ queryKey: ['admin', 'acessos'] })
    },
    onError: (e: Error) => setErro(e.message),
  })

  const podeMexer = data?.souMaster ?? false

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="busca-acesso" className="text-eyebrow uppercase text-texto-ter">
          Achar alguém para dar acesso
        </label>
        <input
          id="busca-acesso"
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="nome, matrícula ou login"
          className="w-full max-w-md rounded-campo border border-borda bg-superficie px-3 py-[9px] text-corpo focus:border-borda-hover focus:outline-none"
        />
        <p className="text-legenda text-texto-ter">
          {buscando
            ? 'Mostrando quem casa com a busca. Limpe o campo para ver só quem já tem acesso.'
            : 'Sem busca, a lista mostra quem já administra ou já está fora da cadeia de ajuda.'}
        </p>
      </div>
      {!podeMexer && (
        <p className="rounded-card border border-borda bg-superficie px-4 py-3 text-corpo text-texto-sec">
          Você administra o portal, e conceder acesso é do administrador principal. Esta lista é
          somente leitura para você.
        </p>
      )}

      {erro && (
        <p
          role="alert"
          className="rounded-card border border-critico-borda bg-critico-bg px-4 py-3 text-corpo text-critico-texto"
        >
          {erro}
        </p>
      )}

      <div className="overflow-x-auto rounded-card border border-borda bg-superficie shadow-card">
        <table className="w-full border-collapse text-corpo">
          <thead>
            <tr className="border-b border-borda text-eyebrow uppercase text-texto-ter">
              <th className="px-4 py-3 text-left font-semibold">Pessoa</th>
              <th className="px-4 py-3 text-left font-semibold">Nível</th>
              <th className="px-4 py-3 text-left font-semibold">Administração</th>
              <th className="px-4 py-3 text-left font-semibold">Recebe ação</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-texto-sec">
                  Carregando…
                </td>
              </tr>
            )}
            {/*
              O VAZIO DIZ QUAL DOS DOIS VAZIOS É — são causas diferentes e a
              saída de cada uma é outra. "Ninguém casa com a busca" pede outro
              texto; "ninguém tem acesso" é o estado normal de um portal novo.
            */}
            {!isPending && data?.acessos.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-texto-sec">
                  {buscando
                    ? `Ninguém encontrado para "${busca}". A pessoa precisa ter entrado no portal ao menos uma vez, ou ter vindo na carga de usuários.`
                    : 'Ninguém além do administrador principal tem acesso. Busque uma pessoa acima para conceder.'}
                </td>
              </tr>
            )}
            {(data?.acessos ?? []).map((a) => (
              <Linha
                key={a.login}
                acesso={a}
                podeMexer={podeMexer}
                salvando={salvar.isPending}
                aoMudar={(mudanca) => {
                  if (a.matricula === null) return
                  salvar.mutate({
                    matricula: a.matricula,
                    papelAdmin: a.papelAdmin,
                    recebeAcao: a.recebeAcao,
                    ...mudanca,
                  })
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-legenda text-texto-ter">
        Quem administra sem receber ação vê o quadro do N2 e não entra na cadeia de ajuda: não
        aparece na lista de responsáveis e não recebe escalação nem direcionamento. Pode abrir
        ação, sempre para outra pessoa.
      </p>
    </div>
  )
}

function Linha({
  acesso,
  podeMexer,
  salvando,
  aoMudar,
}: {
  acesso: AcessoDoPortal
  podeMexer: boolean
  salvando: boolean
  aoMudar: (mudanca: Partial<{ papelAdmin: PapelAdmin; recebeAcao: boolean }>) => void
}) {
  /*
   * A âncora aparece e o PAPEL dela não se mexe -- é a trava que impede o portal
   * ficar sem ninguém que conceda acesso, e o motivo vai escrito ao lado.
   *
   * Mas o `recebe_acao` da âncora MUDA (21/09/2026): tirá-la da cadeia de ajuda
   * não deixa o portal sem quem administra. A trava larga de antes prendia os
   * dois e deixava a própria conta âncora presa recebendo ação sem participar do
   * GD. O backend acompanha -- ver o comentário da âncora em admin/routes.ts.
   */
  const semAcesso = acesso.matricula === null || !podeMexer
  const papelTravado = acesso.ancora || semAcesso
  const recebeTravado = semAcesso

  return (
    <tr className="border-b border-borda last:border-b-0">
      <td className="px-4 py-3">
        <span className="block font-medium text-texto">{acesso.nome}</span>
        <span className="block text-legenda text-texto-ter">
          {acesso.login}
          {acesso.matricula !== null && ` · ${String(acesso.matricula)}`}
          {!acesso.ativo && ' · desativado'}
        </span>
      </td>
      <td className="px-4 py-3 text-texto-sec">{acesso.nivel}</td>
      <td className="px-4 py-3">
        {acesso.ancora ? (
          <span className="inline-flex flex-col">
            <span className="font-medium text-texto">{ROTULO_PAPEL.MASTER}</span>
            <span className="text-legenda text-texto-ter">
              Definido no código — não pode ser revogado por aqui
            </span>
          </span>
        ) : (
          <select
            className="rounded-md border border-borda bg-superficie px-2 py-1 text-corpo text-texto disabled:opacity-60"
            value={acesso.papelAdmin}
            disabled={papelTravado || salvando}
            onChange={(e) => aoMudar({ papelAdmin: e.target.value as PapelAdmin })}
            aria-label={`Papel de administração de ${acesso.nome}`}
          >
            {(['NENHUM', 'ADMIN', 'MASTER'] as const).map((p) => (
              <option key={p} value={p}>
                {ROTULO_PAPEL[p]}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="px-4 py-3">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={acesso.recebeAcao}
            disabled={recebeTravado || salvando}
            onChange={(e) => aoMudar({ recebeAcao: e.target.checked })}
            aria-label={`${acesso.nome} recebe contramedida`}
          />
          <span className="text-texto-sec">{acesso.recebeAcao ? 'Sim' : 'Não'}</span>
        </label>
      </td>
    </tr>
  )
}
