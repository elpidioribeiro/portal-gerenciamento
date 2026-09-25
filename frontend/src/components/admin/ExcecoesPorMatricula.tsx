import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, mensagemDeErro } from '../../lib/api.js'

/**
 * **O cadastro do N2**: uma matrícula por linha, e ela **vence o cargo**.
 *
 * O N2 é corporativo e não se identifica por perfil — perfil é CARGO, e cargo
 * nem sempre diz o papel no GD: alguém com o `id_perfil` de gerente geral,
 * associado a N3, pode responder como N2. Sem isto a saída seria reclassificar
 * o perfil inteiro, levando junto todo mundo com aquele cargo.
 *
 * Ver PLANO §7.20.
 *
 * **A matrícula não é o login.** Um é `u10001abc`, o outro é `10001` — e é o
 * segundo que vai aqui. Errar isso não dá erro: a linha é gravada e nunca casa
 * com ninguém, e a pessoa continua com o nível do cargo.
 */
export function ExcecoesPorMatricula() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'matriculas'],
    queryFn: adminApi.matriculas,
  })

  const [matricula, setMatricula] = useState('')
  const [descricao, setDescricao] = useState('')

  const recarregar = () => queryClient.invalidateQueries({ queryKey: ['admin'] })

  const salvar = useMutation({
    // O nível não é escolhido: cadastrar a matrícula É cadastrar o N2.
    mutationFn: () => adminApi.salvarMatricula(Number(matricula), { descricao: descricao.trim() }),
    onSuccess: async () => {
      await recarregar()
      setMatricula('')
      setDescricao('')
    },
  })

  const remover = useMutation({
    mutationFn: (m: number) => adminApi.removerMatricula(m),
    onSuccess: recarregar,
  })

  const podeSalvar = matricula.trim() !== '' && Number(matricula) > 0 && descricao.trim() !== ''
  const falha = salvar.error ?? remover.error ?? error

  return (
    <section className="flex flex-col gap-3 rounded-cartao border border-borda bg-superficie p-4">
      <div>
        <h2 className="text-base font-bold">O N2, por matrícula</h2>
        <p className="text-legenda text-texto-sec">
          O N2 é corporativo e se cadastra <strong>pessoa a pessoa</strong>, não por cargo — e este
          cadastro <strong>vence o nível do perfil</strong>. Use quando alguém responde como N2 sem
          reclassificar o cargo inteiro, que levaria junto todo mundo que o tem.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-controle border border-borda-sutil bg-fundo p-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (podeSalvar) salvar.mutate()
        }}
      >
        <label className="flex flex-col gap-[6px]">
          <span className="text-eyebrow uppercase text-texto-ter">Matrícula</span>
          <input
            className="h-[34px] w-28 rounded-controle border border-borda bg-superficie px-2 text-legenda"
            inputMode="numeric"
            placeholder="10001"
            value={matricula}
            onChange={(e) => setMatricula(e.target.value.replace(/\D/g, ''))}
          />
          {/*
            O aviso não é decoração: `u10001abc` é o login e `10001` é a
            matrícula. Digitar o login aqui não dá erro — grava uma linha que
            nunca casa com ninguém.
          */}
          <span className="text-[11px] text-texto-ter">só números, não o login</span>
        </label>

        <label className="flex min-w-[220px] flex-1 flex-col gap-[6px]">
          <span className="text-eyebrow uppercase text-texto-ter">Quem é, e por quê</span>
          <input
            className="h-[34px] rounded-controle border border-borda bg-superficie px-2 text-legenda"
            placeholder="Pedro Souto — responde como N2"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </label>

        <button
          type="submit"
          disabled={!podeSalvar || salvar.isPending}
          className="h-[34px] rounded-controle bg-navy px-4 text-legenda font-bold text-white disabled:opacity-40"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </form>

      {falha && (
        <p className="text-legenda text-critico">{mensagemDeErro(falha, 'salvar o cadastro')}</p>
      )}

      {isLoading && <p className="text-legenda text-texto-ter">Carregando…</p>}

      {data && data.matriculas.length === 0 && (
        <p className="text-legenda text-texto-ter">
          Ninguém cadastrado — todo mundo segue o nível do próprio cargo.
        </p>
      )}

      {data && data.matriculas.length > 0 && (
        <table className="w-full text-legenda">
          <thead>
            <tr className="text-eyebrow uppercase text-texto-ter">
              <th className="py-1 text-left font-bold">Matrícula</th>
              <th className="py-1 text-left font-bold">Nível</th>
              <th className="py-1 text-left font-bold">Quem é</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.matriculas.map((m) => (
              <tr key={m.matricula} className="border-t border-borda-sutil">
                <td className="py-2 font-bold tabular-nums">{m.matricula}</td>
                <td className="py-2">{m.nivel}</td>
                <td className="py-2 text-texto-sec">{m.descricao}</td>
                <td className="py-2 text-right">
                  <button
                    className="text-legenda text-texto-ter hover:text-critico"
                    onClick={() => remover.mutate(m.matricula)}
                    disabled={remover.isPending}
                  >
                    remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
