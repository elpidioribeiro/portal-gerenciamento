/**
 * Peças compartilhadas pelos dois painéis da administração.
 *
 * `tituloDeCargo` mora aqui porque os dois usam: a classificação pré-preenche a
 * descrição com ele, e a associação de variáveis exibe o cargo do perfil
 * escolhido — as duas telas mostrando o mesmo cargo em caixas diferentes
 * pareceria descuido.
 */

/**
 * Preposições e conjunções que ficam minúsculas no meio do nome.
 *
 * Sem esta lista, "GERENTE CORP DE PREV E PERDAS" viraria "Gerente Corp De Prev
 * E Perdas". As descrições que já existem no banco seguem esta convenção, e
 * misturar as duas na mesma coluna pareceria erro.
 */
const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'a', 'o', 'para'])

/**
 * Converte o cargo do RH (caixa alta) para caixa de título.
 *
 * O RH grava tudo em maiúsculas — "ANALISTA DE DADOS OPERACOES PL". Exibir
 * assim ao lado de descrições em caixa de título parece erro, e digitar
 * centenas de descrições à mão não é opção.
 *
 * Palavra de até três letras que não seja preposição fica em MAIÚSCULA: são
 * siglas ("PL", "SR", "ADS", "GR1", "CD"), e "Pl" estaria errado.
 */
export function tituloDeCargo(cargo: string): string {
  return cargo
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .filter(Boolean)
    .map((palavra, i) => {
      if (i > 0 && MINUSCULAS.has(palavra)) return palavra
      if (palavra.length <= 3) return palavra.toLocaleUpperCase('pt-BR')
      return palavra.charAt(0).toLocaleUpperCase('pt-BR') + palavra.slice(1)
    })
    .join(' ')
}

type Tom = 'neutro' | 'ok' | 'critico'

const TONS: Record<Tom, { valor: string; borda: string }> = {
  neutro: { valor: 'text-texto', borda: 'border-borda' },
  ok: { valor: 'text-ok-texto', borda: 'border-ok-borda' },
  critico: { valor: 'text-critico-texto', borda: 'border-critico-borda' },
}

export function CartaoResumo({
  rotulo,
  valor,
  tom = 'neutro',
  nota,
}: {
  rotulo: string
  valor: number
  tom?: Tom
  nota?: string
}) {
  const t = TONS[tom]
  return (
    <div className={`rounded-card border ${t.borda} bg-superficie px-4 py-3 shadow-card`}>
      <p className="text-eyebrow uppercase text-texto-ter">{rotulo}</p>
      <p className={`mt-1 tabular text-kpi ${t.valor}`}>{valor.toLocaleString('pt-BR')}</p>
      {nota && <p className="mt-[2px] text-micro text-texto-ter">{nota}</p>}
    </div>
  )
}

export function Estado({ texto, erro = false }: { texto: string; erro?: boolean }) {
  return (
    <div className="rounded-card border border-borda bg-superficie px-6 py-8 shadow-card">
      <p className={`text-corpo ${erro ? 'text-critico-texto' : 'text-texto-sec'}`}>{texto}</p>
    </div>
  )
}
