/**
 * A gerência da pessoa, lida do `id_perfil`.
 *
 * MORA AQUI, e não dentro de um módulo, porque DUAS telas dependem dela e
 * precisam concordar: o quadro do N4 abre na gerência certa, e o formulário de
 * abrir ação trava a gerência da ação na mesma. Duas cópias do mapa seriam duas
 * respostas para "de quem é este quadro" -- e a divergência não daria erro,
 * daria a ação no quadro do vizinho.
 *
 * Não é atalho: o perfil **é** a gerência no sistema corporativo — 18 é VENDAS
 * CONSTRUCAO e 19 é VENDAS NAO CONSTRUCAO. O portal só está lendo o que o
 * cadastro do RH já diz, em vez de pedir a mesma informação de novo.
 *
 * Sem isto o quadro abria na primeira gerência da lista, e um adjunto de Não
 * Construção via Construção até trocar no seletor. Não dá erro — dá a reunião
 * errada, que é pior de descobrir.
 *
 * **Duas coisas que quem mexer aqui precisa saber:**
 *
 *  - o nome tem de bater com `dimensao_gerencia.nome`, **com acento e caixa**.
 *    A dimensão nasce da carga, não daqui; se a carga mudar a grafia, esta
 *    função devolve um nome que não existe e o quadro volta a abrir na
 *    primeira, em silêncio;
 *  - só cobre as gerências de VENDA. Expedição e Armazenagem caem no `null`,
 *    e o quadro delas abre na primeira da lista até terem regra própria.
 *
 * O lugar definitivo é a carga de cadastro de área e gerência (PLANO §7.18),
 * que traz `TIPO_AREA` cru e deixa uma tabela dizer o que cada um vira —
 * gerência nova passa a ser uma linha, não um deploy. Quando ela existir, o
 * `minha` da resposta passa a sair de lá e a tela não muda.
 */
const GERENCIA_POR_PERFIL: Record<number, string> = {
  18: 'CONSTRUÇÃO',
  19: 'NÃO CONSTRUÇÃO',
}

export function gerenciaDoPerfil(idPerfil: number | null): string | null {
  if (idPerfil === null) return null
  return GERENCIA_POR_PERFIL[idPerfil] ?? null
}
