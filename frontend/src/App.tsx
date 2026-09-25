import { Acoes } from './routes/Acoes.js'
import { PontosCausa } from './routes/PontosCausa.js'
import { Contramedida } from './routes/Contramedida.js'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthGuard } from './components/AuthGuard.js'
import { PortaoNivel } from './components/PortaoNivel.js'
import { Layout } from './components/layout/Layout.js'
import { AvisoDaTelaProvider } from './contexts/AvisoDaTelaContext.js'
import { GdsDaTelaProvider } from './contexts/GdsDaTelaContext.js'
import { PeriodoProvider } from './contexts/PeriodoContext.js'
import { SessaoProvider, useSessao } from './contexts/SessaoContext.js'
import { useVisao, VisaoProvider } from './contexts/VisaoContext.js'
import { quadroDoNivel } from './lib/quadro-do-nivel.js'
import { Admin } from './routes/Admin.js'
import { Indicador } from './routes/Indicador.js'
import { Login } from './routes/Login.js'
import { QuadroIndicadores } from './routes/QuadroIndicadores.js'
import { ReuniaoN3 } from './routes/ReuniaoN3.js'
import { ReuniaoN4 } from './routes/ReuniaoN4.js'

/**
 * Rotas conforme o handoff. As telas internas entram nas etapas 4–9 do
 * PLANO.md; por ora existe a casca (header + navegação) e a tela de Login.
 */
export function App() {
  return (
    <SessaoProvider>
      {/* Dentro de SessaoProvider: a visão simulada só vale para administrador,
          e quem é administrador vem da sessão. */}
      <VisaoProvider>
        <PeriodoProvider>
          {/* Os GDs que a tela atual oferece — lidos pelo cabeçalho. Ver o
              contexto, onde está escrito por que não é uma consulta lá. */}
          <GdsDaTelaProvider>
            <AvisoDaTelaProvider>
          <Routes>
            {/* Sempre alcançável por URL, mesmo com o bypass de desenvolvimento
                ligado — senão não haveria como revisar a tela. */}
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<AreaInterna />} />
          </Routes>
            </AvisoDaTelaProvider>
          </GdsDaTelaProvider>
        </PeriodoProvider>
      </VisaoProvider>
    </SessaoProvider>
  )
}

/**
 * A porta de entrada depende do NÍVEL, porque o quadro de cada um é outro: o
 * N2 abre a visão da diretoria, o N4 abre a reunião da área dele.
 *
 * Mandar todo mundo para `/painel` fazia o N4 cair na tela do N2 — que o
 * servidor recusa pelo escopo, e o que ele veria seria um erro em vez do
 * próprio quadro.
 */
function Inicio() {
  const { usuario } = useSessao()
  /*
   * O nível EFETIVO, e não o do cadastro (10/09/2026).
   *
   * Achado ao conferir o conserto do cabeçalho: com a visão `N3 · CEN` ativa,
   * abrir `/` mandava o N2 para `/painel` — a tela da diretoria sob um recorte
   * de uma loja. Mesmo defeito da aba "Indicadores", num quarto lugar.
   *
   * A regra que separa os dois casos está escrita em `quadro-do-nivel.ts`:
   * quem LÊ o estado atual usa o efetivo; quem TROCA de visão usa o nível que
   * está escolhendo.
   */
  const { pedido } = useVisao()
  return <Navigate to={quadroDoNivel(pedido?.nivel ?? usuario?.nivel)} replace />
}

function AreaInterna() {
  return (
    <AuthGuard>
      <PortaoNivel>
        <Layout>
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/painel" element={<QuadroIndicadores />} />
              <Route
                path="/indicador/:indicador/:filial"
                element={<Indicador />}
              />
              <Route path="/admin" element={<Admin />} />
              <Route path="/acoes" element={<Acoes />} />
              <Route path="/pontos-causa" element={<PontosCausa />} />
              {/*
                Uma rota por nível, e não uma tela que se adapta: são estruturas
                diferentes — o N4 abre por área de venda, o N3 por gerência. Ver
                PLANO §7.23.
              */}
              <Route path="/reuniao" element={<ReuniaoN4 />} />
              <Route path="/reuniao-n3" element={<ReuniaoN3 />} />
              <Route path="/contramedida/:codigo" element={<Contramedida />} />
              <Route path="/fechamento" element={<EmConstrucao tela="Fechamento de custo" />} />
              <Route path="*" element={<EmConstrucao tela="Rota não encontrada" />} />
          </Routes>
        </Layout>
      </PortaoNivel>
    </AuthGuard>
  )
}

function EmConstrucao({ tela }: { tela: string }) {
  return (
    <div className="rounded-card border border-borda bg-superficie px-8 py-6 shadow-card">
      <p className="text-eyebrow uppercase text-texto-ter">Portal GD</p>
      <h1 className="mt-1 text-titulo-tela">{tela}</h1>
      <p className="mt-2 text-corpo text-texto-sec">Tela ainda não implementada.</p>
    </div>
  )
}
