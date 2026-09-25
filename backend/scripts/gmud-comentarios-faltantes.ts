/**
 * Os COMMENTs que o banco de desenvolvimento ainda não tem.
 *
 * O padrão AcmeLabs (§7) exige COMMENT na tabela e em **todas** as colunas, e
 * uma GMUD sem isso é devolvida. O banco de desenvolvimento tem a maior parte
 * — aplicada pelos scripts 3 e 5 —, e **77 colunas em 12 tabelas ficaram de
 * fora**: as que nasceram depois daqueles scripts, mais as do resumo mensal.
 *
 * Este arquivo cobre o que falta, e existe separado do gerador por uma razão
 * prática: ele é texto que uma pessoa escreve e revisa, enquanto o gerador é
 * mecânico. Misturá-los faria a revisão do texto passar por 400 linhas de SQL.
 *
 * **As descrições dizem o que a coluna SIGNIFICA, não o que ela é.** "Valor da
 * venda" não ajuda ninguém; "valor realizado no dia, sem imposto, como vem do
 * Power BI" responde a pergunta que faz alguém abrir o comentário às onze da
 * noite. É a mesma regra do `gerar-gmud-comentarios.ts`.
 *
 * **Sem acento**, como os scripts 1 a 7: o padrão pede página de código que
 * permita acentuação, e os scripts existentes optaram por ASCII para não
 * depender do editor de quem executa.
 */

/** Descrição do objeto. A chave é o nome da tabela ou da view. */
export const FALTANTES_TABELA: Record<string, string> = {
  dia_util:
    'Calendario de dias uteis por filial e dia, vindo do Oracle. E o DENOMINADOR do rateio: a cota do mes e dividida por estes dias, e o acumulado ate a data e o que se compara com o realizado.',

  dimensao_gerencia:
    'Gerencias de uma filial - Construcao, Nao Construcao, Operacional. E o agrupamento do N4: cada gerencia tem a sua reuniao diaria, e as areas de venda pertencem a ela.',

  dimensao_vendedor:
    'Cadastro do vendedor e a area de venda a que ele pertence. Retrato do Oracle, sem janela de tempo: a carga substitui a linha inteira.',

  fato_venda_vendedor:
    'Venda de um vendedor num dia. E o grao mais fino do portal, e sustenta Performance Vendedor - quantos bateram a cota. Janela de 60 dias; o que passa disso vive no resumo mensal.',

  gerencia_variavel:
    'Quais variaveis de controle uma gerencia acompanha. Sem linha aqui, a gerencia nao tem KPI na reuniao.',

  matricula_nivel:
    'Nivel do GD por MATRICULA, e ele VENCE o nivel do perfil. Existe porque perfil e cargo, e cargo nem sempre diz o papel no GD: ha quem tenha cargo de N3 e responda como N2. Reclassificar o perfil inteiro levaria junto todo mundo daquele cargo.',

  ocorrencia_ponto_causa:
    'Quantas vezes um ponto de causa foi contado numa semana. E o que a reuniao PRODUZ: a contagem feita na frente do quadro, que alimenta o Pareto e justifica a contramedida.',

  perfil_variavel:
    'Quais variaveis de controle um perfil corporativo enxerga. Sem linha aqui, a pessoa entra no portal e nao ve variavel nenhuma.',

  venda_area_mes:
    'Resumo MENSAL de venda por area, consolidado a partir do detalhe diario antes de ele ser expurgado. E o que sustenta o historico de doze meses depois que a janela de 60 dias passa.',

  vendedor_area_mes:
    'Resumo MENSAL de Performance Vendedor por area: quantos estavam aptos e quantos bateram a cota. Consolidado antes do expurgo do detalhe.',

  vendedor_mes:
    'Situacao e cota de um vendedor numa competencia. SUBSTITUI as competencias do lote a cada carga - a cota e revisada durante o mes, e guardar versoes antigas faria a Performance Vendedor de ontem discordar da de hoje.',
}

/** Descrição da coluna. A chave é `tabela.coluna`. */
export const FALTANTES_COLUNA: Record<string, string> = {
  // ── dia_util ───────────────────────────────────────────────────────────────
  'dia_util.id': 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.',
  'dia_util.filial_id': 'Filial a que o calendario pertence. Referencia filial.id.',
  'dia_util.data': 'Dia a que a linha se refere, na data da ORIGEM (D-1 em relacao a carga).',
  'dia_util.dia_util': 'Indica se o dia conta para o rateio da cota. Dominio: true-SIM false-NAO.',
  'dia_util.acumulado_dia':
    'Dias uteis decorridos no mes ate esta data, inclusive. E o numerador do rateio: cota mensal dividida por uteis_do_mes, vezes este numero.',
  'dia_util.uteis_do_mes':
    'Total de dias uteis da competencia. Conferido contra o QTUTIL da origem na ingestao - divergencia aqui muda toda meta do mes.',
  'dia_util.sync_id':
    'Execucao de carga que gravou esta linha. Referencia execucao_sincronizacao.id, e permite rastrear de onde veio cada numero.',
  'dia_util.atualizado_em': 'Momento da ultima gravacao desta linha pela ingestao.',

  // ── dimensao_gerencia ──────────────────────────────────────────────────────
  'dimensao_gerencia.id': 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.',
  'dimensao_gerencia.filial_id': 'Filial a que a gerencia pertence. Referencia filial.id.',
  'dimensao_gerencia.nome':
    'Nome da gerencia, COM acento e caixa como vem da carga - CONSTRUCAO, NAO CONSTRUCAO. A grafia importa: o portal casa este nome com o agrupamento de mesmo nome para achar o quadro da gerencia.',

  // ── dimensao_vendedor ──────────────────────────────────────────────────────
  'dimensao_vendedor.id': 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.',
  'dimensao_vendedor.filial_id': 'Filial onde o vendedor trabalha. Referencia filial.id.',
  'dimensao_vendedor.cod_vendedor':
    'Codigo do vendedor no sistema de origem. E a chave que liga o fato diario a este cadastro.',
  'dimensao_vendedor.matricula': 'Matricula do colaborador no cadastro corporativo (numcad).',
  'dimensao_vendedor.nome': 'Nome do vendedor, como exibido na tela.',
  'dimensao_vendedor.area_venda_id':
    'Area de venda a que o vendedor pertence HOJE. Referencia dimensao_area_venda.id. Realocacao muda esta coluna e NAO reescreve o passado - o fato diario guarda a area da epoca.',

  // ── fato_venda_vendedor ────────────────────────────────────────────────────
  'fato_venda_vendedor.id': 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.',
  'fato_venda_vendedor.filial_id': 'Filial da venda. Referencia filial.id.',
  'fato_venda_vendedor.data': 'Dia da venda, na data da ORIGEM (D-1 em relacao a carga).',
  'fato_venda_vendedor.vendedor_id': 'Vendedor que realizou a venda. Referencia dimensao_vendedor.id.',
  'fato_venda_vendedor.valor': 'Valor vendido no dia, sem imposto, como vem da origem.',
  'fato_venda_vendedor.sync_id':
    'Execucao de carga que gravou esta linha. Referencia execucao_sincronizacao.id.',
  'fato_venda_vendedor.atualizado_em': 'Momento da ultima gravacao desta linha pela ingestao.',

  // ── gerencia_variavel ──────────────────────────────────────────────────────
  'gerencia_variavel.gerencia_id': 'Gerencia que acompanha a variavel. Referencia dimensao_gerencia.id.',
  'gerencia_variavel.criado_em': 'Momento em que a associacao foi criada.',

  // ── matricula_nivel ────────────────────────────────────────────────────────
  'matricula_nivel.matricula':
    'Matricula do colaborador (numcad), e NAO o login. Sao coisas diferentes: o login e u10001abc, a matricula e 10001. Chave primaria.',
  'matricula_nivel.nivel':
    'Nivel do GD atribuido a esta pessoa, vencendo o nivel do perfil dela. Dominio em nivel_type: N2-diretoria e gerencia corporativa, N3-gerencia geral de loja, N4-gerencia adjunta.',
  'matricula_nivel.descricao': 'Por que esta pessoa tem nivel proprio. Texto livre, para quem revisar o cadastro depois.',
  'matricula_nivel.ativo':
    'Enquanto verdadeiro, esta linha vence o perfil. Falso devolve a pessoa ao nivel do cargo dela. Dominio: true-SIM false-NAO.',
  'matricula_nivel.criado_em': 'Momento em que o nivel proprio foi cadastrado.',

  // ── ocorrencia_ponto_causa ─────────────────────────────────────────────────
  'ocorrencia_ponto_causa.id':
    'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.',
  'ocorrencia_ponto_causa.ponto_causa_id': 'Ponto de causa contado. Referencia ponto_causa.id.',
  'ocorrencia_ponto_causa.ano': 'Ano de competencia (2000 a 2100).',
  'ocorrencia_ponto_causa.mes': 'Mes de competencia (1 a 12).',
  'ocorrencia_ponto_causa.atualizado_em':
    'Momento da ultima gravacao. A contagem e regravada a cada vez que a reuniao ajusta a grade.',

  // ── perfil_variavel ────────────────────────────────────────────────────────
  'perfil_variavel.id_perfil':
    'Perfil do cadastro corporativo. Uma linha por perfil desde 28/08/2026, quando a lotacao saiu da chave.',
  'perfil_variavel.variavel_controle_id':
    'Variavel que este perfil enxerga. Referencia variavel_controle.id.',
  'perfil_variavel.criado_em': 'Momento em que a associacao foi criada.',

  // ── venda_area_mes ─────────────────────────────────────────────────────────
  'venda_area_mes.id': 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.',
  'venda_area_mes.filial_id': 'Filial a que o resumo se refere. Referencia filial.id.',
  'venda_area_mes.indicador_id': 'Indicador consolidado nesta linha. Referencia indicador.id.',
  'venda_area_mes.area_venda_id': 'Area de venda resumida. Referencia dimensao_area_venda.id.',
  'venda_area_mes.gerencia_id':
    'Gerencia da area NA EPOCA. Gravada aqui e nao lida do cadastro: realocar a area depois nao pode reescrever o passado.',
  'venda_area_mes.ano': 'Ano de competencia (2000 a 2100).',
  'venda_area_mes.mes': 'Mes de competencia (1 a 12).',
  'venda_area_mes.vendido': 'Valor vendido no mes pela area, somado do detalhe diario.',
  'venda_area_mes.dias': 'Quantos dias com venda entraram na soma. Serve para conferir o resumo contra o detalhe.',
  'venda_area_mes.atualizado_em': 'Momento da ultima consolidacao desta competencia.',

  // ── vendedor_area_mes ──────────────────────────────────────────────────────
  'vendedor_area_mes.id': 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.',
  'vendedor_area_mes.filial_id': 'Filial a que o resumo se refere. Referencia filial.id.',
  'vendedor_area_mes.area_venda_id': 'Area de venda resumida. Referencia dimensao_area_venda.id.',
  'vendedor_area_mes.gerencia_id':
    'Gerencia da area NA EPOCA. Gravada aqui para que realocar a area depois nao reescreva o passado.',
  'vendedor_area_mes.ano': 'Ano de competencia (2000 a 2100).',
  'vendedor_area_mes.mes': 'Mes de competencia (1 a 12).',
  'vendedor_area_mes.aptos':
    'Vendedores que CONTAM no denominador: os que estavam trabalhando e com cota no mes. Afastado e demitido ficam de fora.',
  'vendedor_area_mes.na_meta': 'Quantos dos aptos bateram a cota do mes. E o numerador de Performance Vendedor.',
  'vendedor_area_mes.dias': 'Quantos dias uteis a competencia teve. Serve para conferir o rateio da cota.',
  'vendedor_area_mes.atualizado_em': 'Momento da ultima consolidacao desta competencia.',

  // ── vendedor_mes ───────────────────────────────────────────────────────────
  'vendedor_mes.id': 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.',
  'vendedor_mes.filial_id': 'Filial do vendedor na competencia. Referencia filial.id.',
  'vendedor_mes.vendedor_id': 'Vendedor a que a cota se refere. Referencia dimensao_vendedor.id.',
  'vendedor_mes.ano': 'Ano de competencia (2000 a 2100).',
  'vendedor_mes.mes': 'Mes de competencia (1 a 12).',
  'vendedor_mes.meta': 'Cota do vendedor no mes. Rateada por dias uteis para a comparacao diaria.',
  'vendedor_mes.sitafa':
    'Situacao de afastamento do colaborador, como vem do RH. E ela que decide quem CONTA no denominador de Performance Vendedor: so quem esta trabalhando entra.',
  'vendedor_mes.houve_venda':
    'Indica se o vendedor teve alguma venda no mes. Dominio: true-SIM false-NAO.',
  'vendedor_mes.sync_id':
    'Execucao de carga que gravou esta linha. Referencia execucao_sincronizacao.id.',
  'vendedor_mes.atualizado_em': 'Momento da ultima gravacao desta linha pela ingestao.',
}
