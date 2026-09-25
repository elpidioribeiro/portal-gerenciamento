import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { acoesApi, variaveisApi } from '../lib/api.js'

/**
 * Os dados da reunião do N4 — a gerência do adjunto, na semana escolhida.
 *
 * As duas variáveis vêm de rotas separadas de propósito: respondem perguntas
 * diferentes (*quanto se vendeu contra a meta* e *quantos vendedores cumpriram
 * a própria cota*) e nada garante que as duas tenham dado no mesmo dia. Juntá-las
 * numa chamada só faria a falta de uma esconder a outra.
 */

/**
 * As gerências da filial que a VISÃO manda ver.
 *
 * `chave` entra na chave do React Query — sem ela, trocar de visão no cabeçalho
 * devolveria o cache da filial anterior, e a tela mostraria a loja errada sem
 * nenhum sinal de que mudou.
 */
export function useGerencias(p: {
  visao: URLSearchParams
  chave: string
  ano: number
  mes: number
}) {
  return useQuery({
    queryKey: ['gerencias', p.chave, p.ano, p.mes],
    queryFn: () => variaveisApi.gerencias({ visao: p.visao, ano: p.ano, mes: p.mes }),
    staleTime: 5 * 60_000,
  })
}

/*
 * A SEMANA entra na chave e na chamada.
 *
 * Ela move o corte: "como estávamos no fim da S2". Sem ela o quadro mostrava o
 * mês inteiro em toda semana — trocar de S1 para S4 não mudava número nenhum,
 * e o protótipo sempre disse o contrário. Ver PLANO §7.22.
 */
export function usePerformanceVendas(
  gerenciaId: string | null,
  ano: number,
  mes: number,
  semana: number,
) {
  return useQuery({
    queryKey: ['performance-vendas', gerenciaId, ano, mes, semana],
    queryFn: () => variaveisApi.performanceVendas(gerenciaId!, { ano, mes, semana }),
    enabled: gerenciaId !== null,
  })
}

export function usePerformanceVendedor(
  gerenciaId: string | null,
  ano: number,
  mes: number,
  semana: number,
) {
  return useQuery({
    queryKey: ['performance-vendedor', gerenciaId, ano, mes, semana],
    queryFn: () => variaveisApi.performanceVendedor(gerenciaId!, { ano, mes, semana }),
    enabled: gerenciaId !== null,
  })
}

/**
 * A grade. Com `areaVendaId`, a da ÁREA; sem ele, a SOMA da gerência.
 *
 * Conta-se dentro da área de venda, que é a linha do quadro — a mesma linha que
 * já tinha supervisor e número próprio. O que a reunião usa é a soma, no bloco
 * de fora, e ela vem do servidor com `podeMarcar: false`. Ver PLANO §7.59.
 *
 * `areaVendaId` entra na CHAVE da consulta. Sem isso as grades das áreas
 * dividiriam um cache só e todas mostrariam a primeira que carregasse.
 *
 * `habilitada` existe para a grade FECHADA. As áreas chegam a treze na
 * Construção, e treze consultas para treze grades que ninguém abriu custariam
 * a abertura da tela por um dado que não está na tela. Ver §7.59.
 */
export function useGrade(
  variavelId: string | null,
  p: { ano: number; mes: number; gerenciaId: string | null; areaVendaId?: string },
  habilitada = true,
) {
  return useQuery({
    queryKey: ['grade', variavelId, p.ano, p.mes, p.gerenciaId, p.areaVendaId ?? null],
    queryFn: () => variaveisApi.grade(variavelId!, { ...p, gerenciaId: p.gerenciaId! }),
    enabled: habilitada && variavelId !== null && p.gerenciaId !== null,
  })
}

/**
 * AS AÇÕES ABERTAS DA GERÊNCIA — "o que já está sendo feito".
 *
 * O bloco morava no acordeão do N3 e saiu junto com ele em 09/09/2026, quando o
 * cartão de gerência virou link para o N4. Com isso o N3 perdeu de vista o que
 * está sendo feito, e o N4 nunca teve: dava para abrir ação pelo Pareto e não
 * dava para ver as que já existiam. Pedido do analista: *"queria que fosse
 * possível o N3 ver todas as ações abertas também no N4"*. Ver §7.61.
 *
 * Aqui, e não no N3, porque é para lá que o N3 vai agora — a lista fica onde a
 * conversa sobre aquela gerência acontece, e não duplicada nas duas telas.
 *
 * `refetchOnMount: 'always'`: a lista muda por fora desta tela (alguém conclui,
 * escala ou rejeita na tela de contramedida), e voltar do detalhe para a reunião
 * mostrando o estado anterior é o defeito que se lê como "não salvou".
 */
/**
 * As ações de uma LOJA — o bloco da reunião do gerente geral.
 *
 * O par de `useAcoesDaGerencia`, com outro recorte: lá é a gerência, aqui é a
 * loja inteira, porque a reunião do N3 é sobre ela.
 *
 * **Por FILIAL, e não pelo nível do agrupamento.** Cheguei a criar um filtro
 * `quadro=N3` supondo que houvesse agrupamentos do N3 -- e medi: NENHUMA ação
 * tem bucket de nível N3. Todas nascem com o agrupamento da área (N4) e o
 * mantêm mesmo depois de subir: a AC-0178 está em `nivelAtual=N2` com
 * `bucket=Construção`. O parâmetro devolvia lista vazia sempre, e foi removido.
 */
export function useAcoesDaLoja(filial: string | null) {
  return useQuery({
    queryKey: ['acoes-da-loja', filial],
    queryFn: () => acoesApi.lista({ filial: filial! }),
    enabled: filial !== null,
    refetchOnMount: 'always',
  })
}

export function useAcoesDaGerencia(gerenciaId: string | null) {
  return useQuery({
    queryKey: ['acoes-da-gerencia', gerenciaId],
    queryFn: () => acoesApi.lista({ gerenciaId: gerenciaId! }),
    enabled: gerenciaId !== null,
    refetchOnMount: 'always',
  })
}

export function usePareto(
  variavelId: string | null,
  p: { ano: number; mes: number; gerenciaId: string | null },
) {
  return useQuery({
    queryKey: ['pareto', variavelId, p.ano, p.mes, p.gerenciaId],
    queryFn: () => variaveisApi.pareto(variavelId!, { ...p, gerenciaId: p.gerenciaId! }),
    enabled: variavelId !== null && p.gerenciaId !== null,
  })
}

/**
 * Grava a grade de uma ÁREA DE VENDA de uma vez.
 *
 * Era uma requisição POR CLIQUE. O banco responde em ~120 ms por ida e cada
 * toque custava dez idas: marcar cinco células levava a conversa da reunião
 * junto. Agora a tela conta em memória e manda tudo ao confirmar — uma
 * requisição, um Pareto recalculado. Ver PLANO §7.21.
 *
 * Invalida grade E Pareto: a gravação muda os dois, e deixar o Pareto velho na
 * tela mostraria a priorização anterior ao lado do número novo — os dois
 * aparecem juntos, e a discordância entre eles é o que a reunião veria.
 */
export function useGravarGrade(variavelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: {
      gerenciaId: string
      areaVendaId: string
      ano: number
      mes: number
      celulas: Array<{ pontoCausaId: string; semana: number; quantidade: number }>
    }) => variaveisApi.gravarGrade(variavelId, dados),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grade'] })
      /*
       * Os dois leem a mesma linha: gravar a grade muda o Pareto na hora. É o
       * que faz a barra crescer ao lado enquanto se conta -- gestão à vista,
       * e não um gráfico que só atualiza depois.
       */
      void qc.invalidateQueries({ queryKey: ['pareto'] })
    },
  })
}

/**
 * Cria um ponto de causa e faz a grade recarregar.
 *
 * Invalida `grade` SEM filtrar por área: o ponto é da variável, então a linha
 * nova entra na grade de todas as áreas abertas na tela e na soma da gerência.
 * Invalidar só a área de onde se clicou deixaria as vizinhas com uma lista
 * curta — e a soma no fim da tela discordando delas.
 *
 * O Pareto NÃO precisa: ponto sem ocorrência tem peso zero e não entra nele.
 * Invalidar por garantia custaria uma consulta a cada nome criado, no meio da
 * reunião.
 */
export function useCriarPontoCausa(variavelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nome: string) => variaveisApi.criarPontoCausa(variavelId, nome),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grade'] })
    },
  })
}

/**
 * A semana do mês de uma data — S1 a S5.
 *
 * **Segunda a domingo, e tem de ser a MESMA de `lib/semanas.ts` no backend.**
 * A regra: a S1 abre no dia 1, salvo quando ele cai em sábado ou domingo — aí
 * abre na segunda seguinte, e esses um ou dois dias não pertencem a semana
 * nenhuma do mês.
 *
 * Isto aqui já foi `Math.ceil(dia / 7)` — blocos fixos de sete dias — com um
 * comentário afirmando ser o mesmo corte do backend. Não era: em agosto/2026 as
 * duas discordavam em cinco dos nove dias conferidos. Não dava erro porque
 * nunca se cruzavam — a marcação grava só o inteiro `semana`, sem data. Cruzam
 * agora que o KPI é semanal, e "S3" precisa significar a mesma coisa no
 * cabeçalho da área, na grade e no Pareto.
 *
 * Devolve 0 para os dias que ficam fora (1 e 2 de agosto/2026, por exemplo):
 * não é semana nenhuma, e fingir que é a S1 poria a venda deles na primeira
 * barra. Quem precisa de uma semana para MOSTRAR usa `semanaAtual`.
 */
export function semanaDoMes(d: Date): number {
  const ano = d.getFullYear()
  const mes = d.getMonth()
  const dia = d.getDate()

  // Dia da semana do dia 1, com segunda = 0 … domingo = 6.
  const dia1 = (new Date(ano, mes, 1).getDay() + 6) % 7
  // Onde a S1 abre: no dia 1, ou na segunda seguinte quando ele é sáb/dom.
  const inicio = dia1 >= 5 ? 1 + ((7 - dia1) % 7) : 1
  if (dia < inicio) return 0

  /*
   * A S1 pode ser parcial — do dia 1 até o primeiro domingo. Depois dela toda
   * semana tem sete dias, então basta contar a partir do fim da primeira.
   */
  const diasNaPrimeira = inicio === 1 ? 7 - dia1 : 7
  if (dia < inicio + diasNaPrimeira) return 1
  return Math.min(5, 2 + Math.floor((dia - inicio - diasNaPrimeira) / 7))
}

/**
 * A semana que o quadro abre — nunca 0.
 *
 * `semanaDoMes` devolve 0 nos dias que não pertencem a semana nenhuma: 1 e 2 de
 * agosto/2026, por exemplo, quando o mês começa num sábado. É a resposta certa
 * para "em que semana este dia está", e a errada para "qual semana mostrar" —
 * o quadro precisa de uma, e as rotas recusam `semana=0`.
 *
 * Nesses dois dias a S1 ainda não começou, então o que existe para olhar é a
 * S1 mesmo, vazia. Ver `semanasDoMes` no backend.
 */
export function semanaAtual(d: Date): number {
  return Math.max(1, semanaDoMes(d))
}

/**
 * O período escolhido ainda está CORRENDO?
 *
 * Vale para o tempo verbal do cartão "Projeção × meta": *"a projeção de
 * fechamento alcança a meta"* só é verdade enquanto o mês corre. Olhando
 * junho em setembro, ou a S1 estando na S3, o presente afirma sobre agora uma
 * coisa que valia antes -- e ninguém lê um quadro reparando no tempo verbal.
 *
 * SÓ A ÚLTIMA SEMANA DO MÊS CORRENTE está em curso. A S1 vista na S3 é passado:
 * a projeção daquele corte já foi substituída por duas semanas de venda real.
 *
 * Aqui, e não em cada tela, porque o cartão está no N3 e no N4 -- e de duas
 * cópias é sempre a segunda que fica para trás.
 */
export function periodoEmCurso(hoje: Date, ano: number, mes: number, semana: number): boolean {
  const mesCorrente = ano === hoje.getFullYear() && mes === hoje.getMonth() + 1
  return mesCorrente && semana === semanaAtual(hoje)
}

/**
 * A série das cinco semanas — a faísca.
 *
 * Uma chamada por gerência serve as duas telas: o N3 usa o `gerencia`, o N4 usa
 * o `areas`. `staleTime` alto porque ela muda uma vez por dia, quando a carga
 * roda — e ela é a mais cara das requisições do quadro.
 */
export function useSerieSemanal(gerenciaId: string | null, ano: number, mes: number) {
  return useQuery({
    queryKey: ['serie-semanal', gerenciaId, ano, mes],
    queryFn: () => variaveisApi.serieSemanal(gerenciaId!, { ano, mes }),
    enabled: gerenciaId !== null,
    staleTime: 10 * 60_000,
  })
}
