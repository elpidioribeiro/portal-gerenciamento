import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSessao } from '../contexts/SessaoContext.js'
import { authApi, mensagemDeErro, SemConexao } from '../lib/api.js'

/**
 * Tela de login — handoff seção "1. Login".
 * Autenticação corporativa; sem login Microsoft.
 *
 * A FILIAL escolhida aqui diz à API de login central QUAL loja valida a
 * credencial: o login de cada pessoa é por loja. O servidor traduz a sigla para
 * o código (1..9) que a central espera. Quem é do corporativo entra por uma
 * loja, e o perfil (nível, escopo) continua vindo do Oracle pela MATRÍCULA, não
 * da loja escolhida (confirmado em login real de gente da empresa 99).
 */
const FILIAIS = ['CEN', 'NOR', 'SUL', 'LES', 'OES', 'LIT', 'SER', 'CAM', 'PRA']

export function Login() {
  const navegar = useNavigate()
  const { recarregar, usuario } = useSessao()

  const [filial, setFilial] = useState(FILIAIS[0]!)
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [capsLock, setCapsLock] = useState(false)

  const entrar = useMutation({
    mutationFn: () => authApi.login({ filial, login, senha }),
    onSuccess: async () => {
      await recarregar()
      /*
       * Para a RAIZ, e não para `/painel`: quem decide a porta de entrada é o
       * `Inicio`, que já conhece a regra por nível -- o N4 abre a reunião da
       * área, o N3 a da gerência, o N2 o quadro. Mandar todo mundo para
       * `/painel` daqui atropelava essa regra, e o N3 caía na tela do N2.
       */
      void navegar('/', { replace: true })
    },
    onError: (e) => {
      // Três casos distintos, e dizer qual é economiza o tempo de quem procura
      // no lugar errado: servidor fora, credencial recusada, ou o resto.
      // Aqui vale um acréscimo ao texto comum: na tela de LOGIN, servidor fora
      // é lido como senha errada, e dizer que não é a senha poupa a busca no
      // lugar errado.
      if (e instanceof SemConexao) {
        setErro('Servidor fora do ar — não é a sua senha. Verifique se o backend está rodando.')
        return
      }
      setErro(mensagemDeErro(e, 'entrar'))
    },
  })

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!login.trim() || !senha) {
      setErro('Preencha matrícula e senha.')
      return
    }
    setErro(null)
    entrar.mutate()
  }

  /** Digitar limpa o erro — handoff, "Validação (protótipo)". */
  function aoDigitar(set: (v: string) => void) {
    return (v: string) => {
      set(v)
      if (erro) setErro(null)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-[26px] bg-brand-fundo px-4">
      {/* Lockup da marca */}
      <div className="flex items-center gap-3">
        <img src="/assets/logo-mark.svg" alt="" className="h-11 w-auto" aria-hidden />
        <div className="text-[22px] font-extrabold leading-[1.05] tracking-[-0.4px] text-brand-vermelho">
          <div>Acme</div>
          <div className="pl-[26px]">Varejo</div>
        </div>
      </div>

      <form
        onSubmit={enviar}
        noValidate
        className="flex w-[420px] max-w-full flex-col gap-[18px] rounded-card border border-brand-borda bg-white p-8"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-titulo-tela">Portal GD</h1>
          <p className="text-corpo text-brand-texto">Entre com suas credenciais corporativas.</p>
        </div>

        {/*
          Esta tela é alcançável por URL mesmo com sessão ativa, de propósito
          (ver App.tsx: é o que permite revisá-la com o bypass ligado). O efeito
          colateral era ficar preso aqui já autenticado, tentando adivinhar uma
          senha que não é pedida — então quando há sessão, a saída aparece.
          Aviso em vez de redirecionar: redirecionar tiraria a revisibilidade.
        */}
        {usuario && (
          <div className="flex flex-col gap-2 rounded-controle border border-ok-borda bg-ok-bg px-3 py-[10px]">
            <p className="text-corpo text-ok-texto">
              Você já está autenticado como <strong>{usuario.nome}</strong> ({usuario.nivel})
              {usuario.sessaoDeDesenvolvimento && ' — sessão de desenvolvimento'}.
            </p>
            <Link
              to="/"
              className="text-corpo font-semibold text-navy underline underline-offset-2 hover:text-navy-hover"
            >
              Ir para o seu quadro →
            </Link>
          </div>
        )}

        <Campo rotulo="Filial" htmlFor="filial">
          <div className="relative">
            <select
              id="filial"
              value={filial}
              onChange={(e) => setFilial(e.target.value)}
              className="w-full appearance-none rounded-controle border border-brand-borda bg-white px-3 py-[11px] pr-9 text-corpo text-texto"
            >
              {FILIAIS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <Chevron />
          </div>
        </Campo>

        {/*
          O LOGIN VAI MINÚSCULO, e agora se VÊ indo.
          O servidor já normalizava (`login.trim().toLowerCase()`, em
          `provider.ts`), então maiúscula aqui nunca quebrou nada. Normalizar
          também na tela não muda o que a API recebe — muda o que a pessoa
          acredita: com o campo mostrando o que será enviado, o login some da
          lista de suspeitos quando a entrada falha, e sobra a senha, que é onde
          o problema está de verdade.
        */}
        <Campo rotulo="Login ERP" htmlFor="login">
          <input
            id="login"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="f00000abc"
            value={login}
            onChange={(e) => aoDigitar(setLogin)(e.target.value.trim().toLowerCase())}
            className="w-full rounded-controle border border-brand-borda bg-brand-campo px-3 py-[11px] text-corpo text-texto placeholder:text-texto-off"
          />
        </Campo>

        <Campo rotulo="Senha" htmlFor="senha">
          <input
            id="senha"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={senha}
            onChange={(e) => aoDigitar(setSenha)(e.target.value)}
            onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
            onBlur={() => setCapsLock(false)}
            className="w-full rounded-controle border border-brand-borda bg-brand-campo px-3 py-[11px] text-corpo text-texto placeholder:text-texto-off"
          />
          {/*
            A ARMADILHA QUE ISTO FECHA, e ela é assimétrica.

            Com Caps Lock ligado o login sai maiúsculo e o portal conserta; a
            SENHA sai maiúscula e ninguém conserta — ela vai byte a byte para o
            argon2 e para a API. As duas recusas chegam na tela como a mesma
            frase ("login ou senha inválidos"), de propósito, para não permitir
            descobrir quais matrículas existem.

            O resultado é a pior combinação possível para quem está entrando: o
            campo que parece culpado é inofensivo, e o culpado não dá sinal.
          */}
          {capsLock && (
            <p className="mt-[6px] text-micro text-brand-erroTexto">
              Caps Lock ligado. O login o portal corrige sozinho — a senha, não.
            </p>
          )}
        </Campo>

        {erro && (
          <p
            role="alert"
            className="border-l-[3px] border-brand-vermelho bg-brand-erroBg px-3 py-[10px] text-corpo text-brand-erroTexto"
          >
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={entrar.isPending}
          className="w-full rounded-controle bg-brand-btn py-[14px] text-[14px] font-bold text-white transition-colors duration-hover hover:bg-brand-btnHover disabled:opacity-70"
        >
          {entrar.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

function Campo({
  rotulo,
  htmlFor,
  children,
}: {
  rotulo: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={htmlFor} className="text-eyebrow uppercase text-texto-ter">
        {rotulo}
      </label>
      {children}
    </div>
  )
}

/** Chevron do handoff: SVG outline, stroke 1.8, caps redondos. */
function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="pointer-events-none absolute right-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2"
      fill="none"
      stroke="#8592A8"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9.5 12 15.5 18 9.5" />
    </svg>
  )
}
