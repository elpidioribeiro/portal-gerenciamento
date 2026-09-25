import { useState } from 'react'
import { PainelAcessos } from '../components/admin/PainelAcessos.js'
import { PainelCargas } from '../components/admin/PainelCargas.js'
import { PainelPerfis } from '../components/admin/PainelPerfis.js'
import { IconeEscudo } from '../components/ui/Icones.js'
import { useSessao } from '../contexts/SessaoContext.js'

/**
 * Área de administração.
 *
 * As decisões de acesso que sem esta tela só entrariam por SQL. São três
 * cadastros, um por nível (PLANO §7.20):
 *
 *   N4  →  `id_perfil` + variáveis de controle
 *   N3  →  `id_perfil`
 *   N2  →  matrícula, e ela vence o perfil
 *
 * A empresa não entra em nenhum deles: é a filial de quem loga que filtra.
 */

type Aba = 'perfis' | 'cargas' | 'acessos'

const TITULO: Record<Aba, string> = {
  perfis: 'Perfis e níveis',
  cargas: 'Cargas de dado',
  acessos: 'Acessos do portal',
}

const SUBTITULO: Record<Aba, string> = {
  perfis:
    'Quem não está aqui não entra no portal. O N4 leva as variáveis que acompanha, o N3 só o ' +
    'cargo, e o N2 é cadastrado por matrícula — que vence o cargo.',
  cargas:
    'Perdas e Movimentação vêm do Oracle, lidas pelo próprio portal. Vendas e NPS continuam vindo do Power BI pelo n8n.',
  acessos:
    'Quem administra o portal, e quem administra sem participar da cadeia de ajuda. ' +
    'Conceder e revogar é do administrador principal.',
}

export function Admin() {
  const { usuario } = useSessao()
  const [aba, setAba] = useState<Aba>('perfis')

  /**
   * Guarda de tela, não de acesso.
   *
   * O acesso é negado pelo servidor em cada rota de `/admin` — esta checagem
   * evita desenhar uma tela cujos dados virão todos 403. Confiar só nela seria
   * controle de acesso no cliente, que não é controle nenhum.
   */
  if (!usuario?.admin) {
    return (
      <div className="rounded-card border border-borda bg-superficie px-8 py-6 shadow-card">
        <p className="text-eyebrow uppercase text-texto-ter">Portal GD</p>
        <h1 className="mt-1 text-titulo-tela">Administração</h1>
        <p className="mt-2 text-corpo text-texto-sec">
          Esta área é do administrador do portal. Se você precisa classificar perfis ou configurar
          variáveis de controle, peça acesso a quem administra.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-eyebrow uppercase text-texto-ter">
          <IconeEscudo tamanho={13} cor="#8592A8" />
          Administração
        </p>
        <h1 className="text-titulo-tela">{TITULO[aba]}</h1>
        <p className="text-corpo text-texto-sec">{SUBTITULO[aba]}</p>
      </div>

      <nav className="flex gap-1 border-b border-borda" aria-label="Áreas da administração">
        <AbaBotao ativa={aba === 'perfis'} onClick={() => setAba('perfis')}>
          Perfis e níveis
        </AbaBotao>
        <AbaBotao ativa={aba === 'cargas'} onClick={() => setAba('cargas')}>
          Cargas
        </AbaBotao>
        <AbaBotao ativa={aba === 'acessos'} onClick={() => setAba('acessos')}>
          Acessos
        </AbaBotao>
      </nav>

      {aba === 'perfis' && <PainelPerfis />}
      {aba === 'cargas' && <PainelCargas />}
      {aba === 'acessos' && <PainelAcessos />}
    </div>
  )
}

function AbaBotao({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativa ? 'page' : undefined}
      className={[
        'border-b-[3px] px-4 py-[10px] text-corpo transition-colors duration-hover',
        ativa
          ? 'border-escala-ponto font-bold text-texto'
          : 'border-transparent font-medium text-texto-sec hover:text-texto',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
