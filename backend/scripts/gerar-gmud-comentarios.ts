import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

/**
 * Gera os COMMENTs de tabela e coluna exigidos pelo padrão (§7).
 *
 * O banco tinha ZERO. A documentação do modelo vivia no `PLANO.md` e nos
 * comentários do `schema.prisma` — dois lugares que só quem tem o repositório
 * enxerga. Quem abre o banco por fora, que é o caso do DBA e de quem investiga
 * um número errado às onze da noite, não via nada.
 *
 * O texto fica AQUI, e não no `schema.prisma`, por uma razão prática: o Prisma
 * não emite `COMMENT ON`. Levar a descrição para o banco exige SQL de qualquer
 * forma, e tê-la num arquivo só evita a terceira cópia.
 *
 * As descrições dizem o que a coluna SIGNIFICA, não o que ela é. "Valor da
 * venda" não ajuda ninguém; "valor realizado no dia, sem imposto, como vem do
 * Power BI" responde a pergunta que faz alguém abrir o comentário.
 *
 * O script confere que toda coluna do banco tem texto e falha se faltar — sem
 * isso, uma coluna nova nasceria sem comentário e ninguém notaria.
 *
 * Uso: npx tsx --env-file=.env scripts/gerar-gmud-comentarios.ts
 */

const DESTINO = path.resolve(import.meta.dirname, '..', '..', 'docs', 'gmud')
const ESQUEMA = 'public'

/** Colunas que se repetem em várias tabelas, com o mesmo significado. */
const COMUNS: Record<string, string> = {
  id: 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.',
  filial_id: 'Filial a que o registro pertence. Referencia filial.id.',
  data: 'Dia a que o valor se refere, na data da ORIGEM (D-1 em relacao a carga).',
  sync_id:
    'Execucao de carga que gravou esta linha. Referencia execucao_sincronizacao.id, e permite rastrear de onde veio cada numero.',
  atualizado_em: 'Momento da ultima gravacao desta linha pela ingestao.',
  criado_em: 'Momento em que a linha foi criada.',
  ano: 'Ano de competencia (2000 a 2100).',
  mes: 'Mes de competencia (1 a 12).',
  ordem: 'Posicao na exibicao. Menor aparece primeiro.',
  nome: 'Nome exibido na tela.',
  ativo: 'Indica se o registro esta em uso. Domino: true-SIM false-NAO.',
  ip: 'Endereco IP de origem da requisicao.',
  variavel_controle_id: 'Variavel de controle relacionada. Referencia variavel_controle.id.',
  ponto_causa_id: 'Ponto de causa relacionado. Referencia ponto_causa.id.',
  indicador_id: 'Indicador relacionado. Referencia indicador.id.',
  contramedida_id: 'Contramedida a que este registro pertence. Referencia contramedida.id.',
  bucket_id:
    'Agrupamento do GD. Referencia agrupamento.id. A coluna manteve o nome antigo: o padrao rege nome de TABELA, e renomear coluna mexeria no codigo sem ganho de conformidade.',
}

/** Descrição da tabela e das colunas próprias de cada uma. */
const TABELAS: Record<string, { tabela: string; colunas: Record<string, string> }> = {
  filial: {
    tabela: 'Filiais da Acme Varejo. Cadastro base, veio do handoff do Gerenciamento Diario.',
    colunas: {
      sigla: 'Sigla de tres letras usada nas telas e nas cargas (CEN, NOR, SUL...).',
      tipo: 'Tipo da unidade. Domino em tipo_filial_type.',
      ativa: 'Indica se a filial entra nos paineis. Domino: true-SIM false-NAO.',
      codigo:
        'Codigo numerico da filial no sistema corporativo (cod_empresa). E' +
        "' a chave usada para casar com o Oracle.",
    },
  },
  agrupamento: {
    tabela:
      'Agrupamentos do quadro de GD: reunem pessoas, pontos de causa e contramedidas por nivel. Chamavam-se "bucket" no handoff.',
    colunas: {
      nivel: 'Nivel hierarquico a que o agrupamento pertence. Domino em nivel_type.',
      grupo: 'Grupo do agrupamento, usado so no N4 (ex.: Vendas Construcao). Nulo nos demais.',
      nome: 'Nome do agrupamento (Vendas, Suprimentos, Pisos e Revestimentos).',
    },
  },
  usuario: {
    tabela:
      'Pessoas com acesso ao portal. O cadastro espelha o sistema corporativo; a senha so existe no modo de desenvolvimento.',
    colunas: {
      foto: 'Foto vinda da API de login: URL ou base64. NULA e o caso comum, e a tela cai para as iniciais.',
      nomloc:
        'Lotacao (setor) da pessoa no cadastro corporativo. Com `id_perfil`, e o par que diz de quais variaveis a pessoa responde: sem ela, um VENDEDOR receberia as variaveis das 21 lotacoes do cargo. Nulo em usuario que nao vem do sistema corporativo.',
      matricula: 'Matricula do colaborador. Liga a pessoa ao vendedor e a excecao de nivel em matricula_nivel.',
      origem_carga:
        'A linha foi criada pela CARGA e ainda nao teve login. Vira falso no primeiro acesso, e a partir dai a carga nao mexe mais em `ativo` nem em `admin` -- sao decisoes do portal, e quem ja entrou tem estado proprio. Domino: true-SIM false-NAO.',

      login_erp: 'Matricula no formato f00000abc. Chave de identificacao da pessoa.',
      nome: 'Nome completo da pessoa.',
      iniciais: 'Tres letras exibidas no avatar da interface.',
      cargo: 'Cargo da pessoa, como consta no sistema corporativo.',
      nivel:
        'Nivel resolvido. Usado direto apenas quando id_perfil e' +
        "' nulo; havendo perfil, o nivel vem de perfil_nivel a cada requisicao.",
      senha_hash:
        'Hash argon2id da senha. Preenchido SO pelo provedor de autenticacao de desenvolvimento; nulo para quem vem da API corporativa, que autentica fora do portal.',
      ativo:
        'Indica se a pessoa pode entrar. Domino: true-SIM false-NAO. Falso bloqueia senha, cookie e o atalho de desenvolvimento.',
      id_perfil:
        'Perfil no sistema corporativo. E' +
        "' a FONTE do nivel: cargo cruzado com lotacao, resolvido a cada requisicao.",
      admin:
        'Ve todos os niveis e escolhe qual visualizar. Domino: true-SIM false-NAO. E' +
        "' dado, nao codigo: um segundo administrador e' UPDATE, nao deploy.",
    },
  },
  perfil_nivel: {
    tabela:
      'Traduz o perfil do sistema corporativo para o nivel do GD. Sem linha aqui, a pessoa e' +
      "' bloqueada no login.",
    colunas: {
      id_perfil: 'Perfil no sistema corporativo. Chave primaria.',
      nivel: 'Nivel do GD atribuido a este perfil. Domino em nivel_type.',
      descricao: 'Descricao do perfil, copiada do cadastro corporativo para leitura humana.',
      ativo: 'Indica se o mapeamento vale. Domino: true-SIM false-NAO.',
    },
  },
  perfil_variavel: {
    tabela:
      'Quais variaveis de controle cada perfil enxerga, por lotacao e empresa. Configurado na tela de administracao.',
    colunas: {
      id_perfil: 'Perfil no sistema corporativo. Parte da chave primaria.',
      nomloc:
        'Lotacao (setor) da pessoa no cadastro corporativo. NAO e' +
        "' a filial: o mesmo perfil aparece em lotacoes diferentes.",
      cod_empresa: 'Codigo da filial no sistema corporativo. Completa a chave do escopo.',
    },
  },
  indicador: {
    tabela:
      'Os indicadores do GD (Vendas, NPS, Perdas, Custo). Cadastro base, veio do handoff.',
    colunas: {
      indicador_pai_id:
        'Indicador de que este e desdobramento. Referencia indicador.id. NULO no indicador de primeiro nivel. O filho tem grafico, meta, unidade, sentido e regra de status proprios.',

      codigo: 'Codigo curto usado nas rotas e nas cargas (vendas, nps, perdas, custo).',
      unidade: 'Unidade de exibicao do valor (R$, %, pontos).',
      sentido:
        'Se numero maior e' +
        "' melhor ou pior. Domino em sentido_type. Decide a cor do farol.",
      escala_y: 'Limites do eixo do grafico, em JSON. Ancorado na meta cadastrada.',
      regra_status: 'Regra que decide verde, amarelo ou vermelho, em JSON.',
    },
  },
  variavel_controle: {
    tabela:
      'Variaveis de controle de cada indicador: o nivel abaixo do indicador no ciclo do GD.',
    colunas: {
      unidade: 'Unidade de exibicao do valor.',
      sentido: 'Se numero maior e' + "' melhor ou pior. Domino em sentido_type.",
    },
  },
  ponto_causa: {
    tabela:
      'Pontos de causa de cada variavel de controle. Sao as barras do Pareto e a origem das contramedidas.',
    colunas: {},
  },
  meta: {
    tabela: 'Metas mensais, por indicador ou por variavel de controle, por filial.',
    colunas: {
      escopo: 'Se a meta e' + "' de indicador ou de variavel. Domino em escopo_meta_type.",
      alvo_id: 'Identificador do indicador ou da variavel, conforme o escopo.',
      valor: 'Valor da meta no mes, na unidade do alvo.',
    },
  },
  dimensao_area_venda: {
    tabela: 'Areas de venda por filial. Serve ao detalhamento de Vendas por linha.',
    colunas: {
      gerencia_id: 'Gerencia a que a area pertence HOJE. Referencia dimensao_gerencia.id.',
      cd_area:
        'Codigo da area na origem. E por ele que vendedor, area e supervisor se ligam: identificar por nome faria a area virar OUTRA no dia em que alguem corrigisse a grafia no cadastro -- meta orfa de um lado, area sem meta do outro, sem erro nenhum.',
      destaque:
        'A area aparece entre as principais do quadro do N4. Domino: true-SIM false-NAO. Uma gerencia tem ate 28 areas e a reuniao de 15 minutos nao passa por todas; tres por gerencia foi a escolha do analista.',
 supervisor: 'Nome do supervisor responsavel pela area.' },
  },
  dimensao_linha: {
    tabela: 'Linhas de produto por filial. Serve ao detalhamento de Vendas por linha.',
    colunas: { area_venda_id: 'Area de venda a que a linha pertence. Referencia dimensao_area_venda.id.' },
  },
  fato_venda: {
    tabela:
      'Vendas por filial e dia. Substituida por janela a cada carga: o periodo declarado e' +
      "' apagado e regravado.",
    colunas: {
      valor_real: 'Valor realizado no dia, como vem da origem.',
      tendencia: 'Projecao do fechamento do mes, calculada na origem.',
      delta_meta:
        'Desvio percentual da tendencia sobre a meta, calculado na origem. Nulo quando a origem nao envia; nesse caso o portal calcula pela meta cadastrada.',
    },
  },
  fato_venda_linha: {
    tabela: 'Vendas por filial, dia e linha de produto. Detalhamento do indicador de Vendas.',
    colunas: {
      area_venda_id: 'Area de venda da linha. Referencia dimensao_area_venda.id.',
      gerencia_id:
        'Gerencia da area NO DIA DA VENDA, congelada aqui. Nao e lida da dimensao de proposito: a dimensao diz onde a area esta hoje, e ler dela faria a venda de marco passar a contar para a gerencia de hoje quando uma area fosse transferida -- o historico mudaria sozinho, sem ninguem tocar em fato nenhum.',

      linha_id: 'Linha de produto. Referencia dimensao_linha.id.',
      valor: 'Valor vendido na linha, no dia.',
    },
  },
  fato_nps: {
    tabela:
      'Respostas de NPS por filial e dia. O indice e' +
      "' calculado na leitura, nao armazenado, para nao existir em dois lugares.",
    colunas: {
      qtd_promotores: 'Quantidade de respostas promotoras (notas 9 e 10).',
      qtd_neutros: 'Quantidade de respostas neutras (notas 7 e 8).',
      qtd_detratores: 'Quantidade de respostas detratoras (notas 0 a 6).',
    },
  },
  fato_perda: {
    tabela:
      'Perdas por filial, dia e tipo de quebra. Carregada por consulta direta ao Oracle desde 22/08/2026.',
    colunas: {
      tipo_quebra:
        'QI (quebra identificada) ou QNI (nao identificada). Domino em tipo_quebra_type.',
      status:
        'Situacao da quebra. Domino em status_quebra_type. So APROVADA entra no indicador.',
      valor:
        'Valor contabil da perda, COM O SINAL DA ORIGEM. Nenhum sinal esta associado a um tipo: QI e QNI podem vir positivas ou negativas.',
    },
  },
  fato_movimentacao: {
    tabela:
      'Movimentacao (base de calculo de Perdas % Mov) por filial e dia. Carregada por consulta direta ao Oracle.',
    colunas: { valor: 'Valor movimentado no dia.' },
  },
  fato_custo: {
    tabela: 'Custo por filial e competencia. Lancamento manual; ainda sem origem automatica.',
    colunas: {
      valor: 'Valor do custo na competencia.',
      lancado_por_id: 'Pessoa que fez o lancamento. Referencia usuario.id.',
      lancado_em: 'Momento do lancamento.',
    },
  },
  fato_variavel_controle: {
    tabela:
      'Valores das variaveis de controle por filial e dia. Guarda numerador e denominador, nao o resultado.',
    colunas: {
      numerador: 'Numerador do calculo da variavel.',
      denominador:
        'Denominador do calculo. Guardar os dois em vez do resultado permite somar periodos corretamente.',
    },
  },
  ocorrencia_ponto_causa: {
    tabela:
      'Marcacoes de ponto de causa. Cada linha e' +
      "' uma ocorrencia apontada por alguem, e o Pareto e' a contagem delas.",
    colunas: {
      escopo: 'Se a contagem e de uma area de venda ou de uma gerencia inteira. Domino em escopo_ocorrencia_type.',
      alvo_id: 'Identificador da area ou da gerencia, conforme o escopo.',
      semana: 'Semana do mes em que a ocorrencia foi contada (1 a 5). E o corte do quadro: segunda a domingo, com a S1 abrindo no dia 1.',
      quantidade: 'Quantas vezes a causa foi apontada naquela semana. E o que alimenta o Pareto.',

      registrado_por_id: 'Pessoa que marcou a ocorrencia. Referencia usuario.id.',
      registrado_em: 'Momento da marcacao.',
      observacao: 'Texto livre do que foi observado. Opcional.',
    },
  },
  contramedida: {
    tabela:
      'Contramedidas abertas a partir de um ponto de causa. E' +
      "' o fim do ciclo do GD: indicador, variavel, ponto de causa, contramedida.",
    colunas: {
      codigo: 'Codigo legivel no formato AC-0000. Sequencial apenas para leitura humana.',
      titulo: 'Titulo curto da contramedida.',
      pdc_ref: 'Referencia ao PDC (plano de acao) de origem, quando houver.',
      nivel_atual:
        'Nivel onde a contramedida esta agora. Domino em nivel_type. Muda quando ela e' +
        "' escalada.",
      responsavel_atual_id: 'Pessoa responsavel neste momento. Referencia usuario.id.',
      criado_por_id: 'Pessoa que abriu a contramedida. Referencia usuario.id.',
      prazo: 'Data limite acordada para a conclusao.',
      prioridade: 'Prioridade atribuida. Domino em prioridade_type.',
      concluida_em: 'Momento da conclusao. Nulo enquanto estiver aberta.',
      comentario_abertura: 'Texto escrito na abertura, explicando o problema.',
      origem: 'De onde a contramedida nasceu (marcacao de Pareto, reuniao, auditoria).',
    },
  },
  movimentacao: {
    tabela:
      'Historico de movimentacoes de uma contramedida: escalada, mudanca de responsavel, prorrogacao, conclusao.',
    colunas: {
      tipo: 'Tipo da movimentacao. Domino em tipo_movimentacao_type.',
      autor_id: 'Pessoa que fez a movimentacao. Referencia usuario.id.',
      nivel_origem: 'Nivel de onde saiu. Domino em nivel_type.',
      nivel_destino: 'Nivel para onde foi. Domino em nivel_type.',
      bucket_destino_id: 'Agrupamento de destino. Referencia agrupamento.id.',
      responsavel_destino_id: 'Novo responsavel. Referencia usuario.id.',
      motivo: 'Motivo declarado da movimentacao.',
      texto: 'Texto livre complementar.',
      novo_prazo: 'Prazo novo, quando a movimentacao for prorrogacao.',
      resultado_indicador:
        'Resultado do indicador na conclusao. Domino em resultado_indicador_type.',
    },
  },
  comentario: {
    tabela: 'Comentarios escritos numa contramedida.',
    colunas: {
      autor_id: 'Pessoa que escreveu. Referencia usuario.id.',
      texto: 'Conteudo do comentario.',
    },
  },
  execucao_sincronizacao: {
    tabela:
      'Registro de cada carga de dados: o que entrou, quando, de onde e com que resultado. RETENCAO: 12 meses.',
    colunas: {
      fonte: 'Fonte carregada (vendas, nps, perdas, movimentacao, metas).',
      iniciado_em: 'Momento em que a carga comecou.',
      finalizado_em: 'Momento em que terminou. Nulo enquanto estiver rodando.',
      status: 'Resultado da execucao. Domino em status_sync_type.',
      periodo_de: 'Primeiro dia da janela substituida por esta carga.',
      periodo_ate: 'Ultimo dia da janela substituida por esta carga.',
      linhas_recebidas: 'Quantas linhas chegaram no lote.',
      linhas_gravadas: 'Quantas linhas foram efetivamente gravadas.',
      linhas_removidas: 'Quantas linhas a substituicao de janela apagou antes de gravar.',
      erro: 'Mensagem do erro, quando a carga falhou. Nulo em caso de sucesso.',
      origem_ip: 'IP de quem enviou a carga. Distingue o n8n de uma execucao manual.',
    },
  },
  carga_agendamento: {
    tabela:
      'Horario de carga por fonte, editavel na tela. Linha presente sobrepoe o padrao do codigo; ausencia significa usar o padrao.',
    colunas: {
      fonte: 'Fonte cujo horario esta sendo sobreposto. Chave primaria.',
      hora: 'Hora de disparo, 0 a 23.',
      minuto: 'Minuto de disparo, 0 a 59.',
      atualizado_em: 'Momento da ultima alteracao do horario.',
      atualizado_por: 'Pessoa que alterou o horario. Referencia usuario.id.',
    },
  },
  renovacao_sessao: {
    tabela:
      'Tokens de renovacao de sessao. Guardam apenas o hash, nunca o token. RETENCAO: 30 dias apos expirar.',
    colunas: {
      usuario_id: 'Dono da sessao. Referencia usuario.id.',
      token_hash: 'Hash do token de renovacao. O token em si NUNCA e' + "' gravado.",
      familia_id:
        'Agrupa as renovacoes sucessivas de uma mesma sessao. Permite revogar a cadeia inteira ao detectar reuso.',
      expira_em: 'Momento em que o token deixa de valer.',
      revogado_em: 'Momento da revogacao. Nulo enquanto valido.',
      user_agent: 'Identificacao do navegador que abriu a sessao.',
    },
  },
  log_auditoria: {
    tabela:
      'Trilha de auditoria das alteracoes: quem fez, o que, quando e de onde. RETENCAO: 24 meses.',
    colunas: {
      usuario_id: 'Pessoa que executou a acao. Referencia usuario.id. Nulo em acao do sistema.',
      acao: 'Acao executada (criacao, alteracao, exclusao).',
      entidade: 'Tabela afetada pela acao.',
      entidade_id: 'Identificador da linha afetada.',
      payload: 'Conteudo da alteracao, em JSON.',
    },
  },
  vw_tipo_perda: {
    tabela:
      'Desdobramento de Perdas por tipo de quebra. VIEW e nao tabela de proposito: fato_perda ja guarda estes campos, e uma copia poderia divergir.',
    colunas: {
      tipo: 'Tipo da quebra: QI (identificada) ou QNI (nao identificada).',
      valor: 'Valor contabil da perda, com o sinal da origem.',
    },
  },
  dimensao_gerencia: {
    tabela:
      'Gerencias de uma filial -- CONSTRUCAO e NAO CONSTRUCAO. E o recorte da reuniao do N4: cada gerencia tem um gerente adjunto, e o quadro dele e a lista de areas de venda dela.',
    colunas: {},
  },
  dimensao_vendedor: {
    tabela:
      'Cadastro de vendedores por filial, de `vendedor-area.sql`. Inclui conta generica ("VENDA BALCAO" e afins), que e ponto de venda e nao pessoa.',
    colunas: {
      cod_vendedor:
        'Codigo do vendedor na origem (`AGTV.CODIGO`). E a chave que liga as quatro consultas de vendedor entre si -- NAO a matricula, que pode ser nula.',
      matricula:
        'Matricula do colaborador. NULA em conta generica: ponto de venda nao e pessoa e nao tem matricula. E a ponte para o colaborador e para o usuario do portal, nunca a chave.',
      area_venda_id:
        'Area de venda em que o vendedor esta HOJE. Referencia dimensao_area_venda.id. Nao ha historico: transferir um vendedor move toda a venda passada dele junto, e e por isso que o resumo mensal congela a gerencia na linha.',
    },
  },
  fato_venda_vendedor: {
    tabela:
      'Venda de cada vendedor, por dia -- o realizado de Performance Vendedor. RETENCAO: 60 dias. O historico do indicador vive em vendedor_area_mes, consolidado antes do expurgo.',
    colunas: {
      vendedor_id: 'Vendedor que fez a venda. Referencia dimensao_vendedor.id.',
      valor:
        'Venda LIQUIDA do dia: venda menos devolucao mais refaturamento. NAO e a mesma medida de fato_venda_linha (`VALOR_TOTAL`, com despesa, juro, frete e ICMS ST), e os filtros tambem diferem -- a soma das duas NAO BATE, e nao deve. E contra esta medida que a cota do vendedor foi orcada.',
    },
  },
  gerencia_variavel: {
    tabela:
      'Quais variaveis de controle cada gerencia acompanha no quadro. Sem linha aqui a variavel nao aparece na reuniao daquela gerencia -- o quadro mostra o que se acompanha, e nao o que se pretende acompanhar.',
    colunas: {
      gerencia_id: 'Gerencia que acompanha a variavel. Referencia dimensao_gerencia.id.',
    },
  },
  matricula_nivel: {
    tabela:
      'Nivel do GD de uma PESSOA, por matricula. Excecao ao perfil: `id_perfil` e CARGO, e cargo nem sempre diz o papel no GD -- ha quem tenha perfil de N3 e responda como N2. Cadastrada aqui, esta linha VENCE o perfil, sem mescla.',
    colunas: {
      matricula: 'Matricula do colaborador. Chave primaria: uma linha por pessoa.',
      nivel: 'Nivel do GD que a pessoa exerce. Dominio em nivel_type.',
      descricao: 'Quem e a pessoa e por que a excecao existe -- lido por quem for revisar o cadastro.',
    },
  },
  vendedor_mes: {
    tabela:
      'Situacao e cota do vendedor no mes, de `vendedor-situacao.sql`. Grao de competencia, e nao achatavel por vendedor: quem foi COM VENDA em julho pode ser SEM VENDA em agosto.',
    colunas: {
      vendedor_id: 'Vendedor a que a competencia se refere. Referencia dimensao_vendedor.id.',
      meta:
        'Cota mensal do vendedor (`COTA_MENSAL`). ZERO significa sem meta definida, e quem tem zero fica FORA do denominador de Performance Vendedor -- nao entra como "nao bateu". Contar cadastro em branco como falha afundaria a area.',
      sitafa: 'Situacao funcional na origem. 7 e quem nao esta trabalhando, e fica fora da conta.',
      houve_venda:
        'Classificacao do vendedor NO MES, calculada na origem com SYSDATE. Dominio em houve_venda_type. Enquanto o mes corre todos sao MES_EM_VIGOR; quando fecha, a MESMA linha vira COM_VENDA ou SEM_VENDA -- por isso a carga reescreve o mes anterior depois de fechado.',
    },
  },
  dia_util: {
    tabela:
      'Calendario de dias em que a loja abre, por filial. E o denominador do rateio: a cota do vendedor e a meta do mes sao comparadas contra a fracao de dias uteis ja decorridos, e nao contra o mes inteiro.',
    colunas: {
      dia_util: 'A loja abre neste dia. Domino: true-SIM false-NAO.',
      acumulado_dia:
        'Dias uteis decorridos no mes ate e inclusive este dia. E o NUMERADOR do rateio -- no dia 2 de 26, a cota efetiva e um treze avos da mensal.',
      uteis_do_mes:
        'Dias uteis do mes inteiro, como a origem conta (`QTUTIL`). E o divisor do rateio. Repetido em todo dia do mes de proposito: guardar por competencia exigiria uma segunda tabela e um join para responder a pergunta mais comum da tela.',
    },
  },
  venda_area_mes: {
    tabela:
      'Resumo mensal da venda por area: o historico de Performance Vendas. O detalhe em fato_venda_linha retem 60 dias; esta tabela guarda o fechamento de cada mes, consolidado antes do expurgo.',
    colunas: {
      indicador_id: 'Indicador a que o valor se refere. Referencia indicador.id.',
      area_venda_id: 'Area de venda cujo mes esta resumido. Referencia dimensao_area_venda.id.',
      gerencia_id:
        'Gerencia da area NO MES, congelada aqui. Nao e lida da dimensao de proposito: a dimensao diz onde a area esta hoje, e o historico nao pode mudar quando uma area for transferida.',
      vendido:
        'Soma de fato_venda_linha.valor no mes, para esta area e este indicador. Nao inclui a meta: ela vive em meta, por (area, competencia).',
      dias:
        'Quantidade de dias distintos com venda no mes. Distingue mes fechado de mes em curso, e e a trava contra o resumo encolher: recalculo que ve MENOS dias do que o guardado e reposicao parcial, nao correcao, e o valor guardado vale mais.',
    },
  },
  vendedor_area_mes: {
    tabela:
      'Resumo mensal de Performance Vendedor por area: o historico do indicador. Guarda a CONTA JA FEITA, e nao os insumos -- na_meta/aptos de dois meses nao se soma, e o realizado que decide "bateu a cota" e expurgado aos 60 dias.',
    colunas: {
      area_venda_id: 'Area de venda cujo mes esta resumido. Referencia dimensao_area_venda.id.',
      gerencia_id:
        'Gerencia da area NO MES, congelada aqui. Nao e lida da dimensao de proposito: a dimensao diz onde a area esta hoje, e o historico nao pode mudar quando uma area for transferida.',
      aptos:
        'Denominador do indicador: quantos vendedores da area CONTAVAM no mes. Apto e quem tem cota maior que zero, esta ativo (sitafa diferente de 7) e nao foi classificado como SEM_VENDA. Area sem ninguem apto nao gera linha -- ausencia e diferente de zero.',
      na_meta:
        'Numerador do indicador: quantos dos aptos alcancaram a propria cota, rateada pelos dias uteis decorridos. Nunca maior que aptos.',
      dias:
        'Quantidade de dias distintos com venda no mes. E a trava contra o resumo encolher: recalculo que ve MENOS dias do que o guardado e reposicao parcial, nao correcao, e o valor guardado vale mais.',
    },
  },
}

/** Lê a estrutura do banco de teste — é a mesma de todos, vinda das migrações. */
const urlTeste = process.env.DATABASE_URL_TEST
if (urlTeste === undefined || urlTeste.trim() === '') {
  throw new Error('DATABASE_URL_TEST não definida. O gerador lê a estrutura do banco de teste.')
}
const prisma = new PrismaClient({ datasources: { db: { url: urlTeste } } })

/** Aspas simples dobradas: e' o unico escape necessario num literal SQL. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

/**
 * Tabelas cujos COMMENTs vivem em OUTRO script da GMUD.
 *
 * As duas nasceram depois do 3, e o script que as CRIA e o 4 -- comentar aqui
 * faria o 3 falhar em producao, que roda antes: `COMMENT ON` em tabela que
 * ainda nao existe e erro, e a migracao inteira roda em transacao unica.
 *
 * A descricao continua morando aqui, e nao no 4, para nao existir em dois
 * lugares: a conferencia de "toda coluna tem texto" precisa alcanca-la.
 */
/** Comentadas DENTRO do script que as cria -- ver `4-cria_tabela_resumo_mensal.sql`. */
const NO_SCRIPT_4 = ['venda_area_mes', 'vendedor_area_mes']

/**
 * Tabelas que ja existem e nasceram DEPOIS do script 3.
 *
 * Nao da para reabrir o 3: ele pode ja ter sido executado, e um GMUD nao se
 * reescreve depois de aberto. Entao elas ganham o proprio script, com a mesma
 * descricao vinda daqui -- uma casa so para o texto.
 */
const NO_SCRIPT_5 = [
  'dia_util',
  'dimensao_gerencia',
  'dimensao_vendedor',
  'fato_venda_vendedor',
  'gerencia_variavel',
  'matricula_nivel',
  'vendedor_mes',
]

/**
 * COLUNAS que nasceram depois do 3, em tabelas que o 3 JA comenta.
 *
 * Aqui nao da para repetir a tabela inteira: o 3 ja descreveu as colunas
 * antigas, e reemitir tudo faria os dois scripts brigarem pelo mesmo objeto.
 * Entao o 5 comenta so estas, uma a uma.
 */
const COLUNAS_NO_SCRIPT_5: Record<string, string[]> = {
  usuario: ['foto', 'nomloc', 'matricula', 'origem_carga'],
  indicador: ['indicador_pai_id'],
  dimensao_area_venda: ['gerencia_id', 'cd_area', 'destaque'],
  fato_venda_linha: ['area_venda_id', 'gerencia_id'],
  ocorrencia_ponto_causa: ['escopo', 'alvo_id', 'semana', 'quantidade'],
}

const EM_OUTRO_SCRIPT = new Set([
  ...NO_SCRIPT_4,
  ...NO_SCRIPT_5,
])

async function main() {
  mkdirSync(DESTINO, { recursive: true })

  const colunas = await prisma.$queryRawUnsafe<{ t: string; c: string }[]>(`
    SELECT table_name AS t, column_name AS c FROM information_schema.columns
    WHERE table_schema = '${ESQUEMA}' AND table_name <> '_prisma_migrations'
    ORDER BY table_name, ordinal_position`)

  /**
   * `COMMENT ON VIEW` para view, `COMMENT ON TABLE` para tabela.
   *
   * O Postgres recusa `COMMENT ON TABLE` numa view — erro 42809, "is not a
   * table". Vem do catalogo (`relkind`) e nao do prefixo `vw_`: nome e' convencao,
   * e uma view que fugisse dela quebraria a migracao inteira, que roda em
   * transacao unica.
   */
  const especies = new Map(
    (
      await prisma.$queryRawUnsafe<{ nome: string; tipo: string }[]>(`
        SELECT c.relname AS nome, c.relkind::text AS tipo
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '${ESQUEMA}' AND c.relkind IN ('r', 'v', 'm')`)
    ).map((x) => [x.nome, x.tipo === 'r' ? 'table' : x.tipo === 'm' ? 'materialized view' : 'view']),
  )

  const faltando: string[] = []

  /** Os COMMENTs de um conjunto de tabelas, e quantos são. */
  function comentarios(quais: string[]): { sql: string; n: number } {
    let sql = ''
    let n = 0
    for (const tabela of quais) {
      const def = TABELAS[tabela]
      if (!def) continue
      sql += `\n-- ${tabela}\n`
      sql += `comment on ${especies.get(tabela) ?? 'table'} ${ESQUEMA}.${tabela} is ${lit(def.tabela)};\n`
      n++
      for (const { t, c } of colunas.filter((x) => x.t === tabela)) {
        const texto = def.colunas[c] ?? COMUNS[c]
        if (texto === undefined) {
          faltando.push(`${t}.${c}`)
          continue
        }
        sql += `comment on column ${ESQUEMA}.${t}.${c} is ${lit(texto)};\n`
        n++
      }
    }
    return { sql, n }
  }

  /** As remoções correspondentes — `COMMENT ... IS NULL`, que não tem DROP. */
  function remocoes(quais: string[]): string {
    let r = ''
    for (const tabela of quais) {
      if (!TABELAS[tabela]) continue
      r += `\n-- ${tabela}\ncomment on ${especies.get(tabela) ?? 'table'} ${ESQUEMA}.${tabela} is NULL;\n`
      for (const { t, c } of colunas.filter((x) => x.t === tabela))
        r += `comment on column ${ESQUEMA}.${t}.${c} is NULL;\n`
    }
    return r
  }

  /*
   * O script 3 comenta o que EXISTIA quando ele foi gerado. As tabelas que
   * nasceram depois vêm nos scripts 4 e 5 -- um GMUD não se reescreve depois de
   * aberto, e o 3 pode já ter sido executado.
   */
  const noTres = Object.keys(TABELAS).filter((t) => !EM_OUTRO_SCRIPT.has(t))
  const { sql, n } = comentarios(noTres)

  const semDef = [...new Set(colunas.map((c) => c.t))].filter((t) => !(t in TABELAS))
  if (semDef.length > 0) faltando.push(...semDef.map((t) => `${t} (tabela inteira)`))

  if (faltando.length > 0) {
    throw new Error(
      `${faltando.length} objeto(s) sem descricao — o padrao exige COMMENT em TODAS as colunas:\n  ` +
        faltando.join('\n  '),
    )
  }

  const cabecalho = `-- Portal GD - comentarios de tabela e coluna
--
-- O padrao exige COMMENT na tabela e em TODAS as colunas. O banco tinha zero:
-- a documentacao do modelo vivia so no repositorio, invisivel para quem abre o
-- banco por fora.
--
-- Inclui o tempo de retencao das tabelas de log, tambem exigido pelo padrao:
-- log_auditoria 24 meses, execucao_sincronizacao 12 meses, renovacao_sessao 30
-- dias apos expirar. Os prazos ainda precisam do aval do DBA para o job de
-- limpeza ser configurado.
--
-- Recuperacao: 3-cria_comentario-RECUPERA.sql
`

  /*
   * O SCRIPT 3 SÓ É REESCRITO SE ALGUÉM PEDIR.
   *
   * Ele é um artefato de GMUD que pode já ter sido submetido, e um GMUD não se
   * reescreve depois de aberto. Pior: o gerador lê o banco de HOJE, e o
   * esquema andou desde que o 3 foi gerado — rodar sem esta trava trocava o
   * arquivo por um script do esquema atual, apagando de dentro dele a
   * documentação de objetos que ele documentou na época.
   *
   *   npx tsx --env-file=.env scripts/gerar-gmud-comentarios.ts --regenerar-3
   */
  const regenerarTres = process.argv.includes('--regenerar-3')
  if (regenerarTres) {
    writeFileSync(path.join(DESTINO, '3-cria_comentario.sql'), cabecalho + sql, 'utf8')

    let r = `-- Portal GD - RECUPERA comentarios
--
-- Remove os comentarios criados por 3-cria_comentario.sql. COMMENT ... IS NULL
-- e' a forma de apagar; nao existe DROP COMMENT.
`
    // Só o que o 3 comentou: apagar o que ele não criou derrubaria a descrição
    // de tabela que outro script da mesma mudança acabou de documentar.
    r += remocoes(noTres)
    writeFileSync(path.join(DESTINO, '3-cria_comentario-RECUPERA.sql'), r, 'utf8')
  }

  /*
   * O SCRIPT 5 — as seis tabelas que nasceram depois do 3.
   *
   * O texto vem do MESMO dicionário acima: uma casa só para a descrição, e a
   * conferência de "toda coluna tem comentário" alcança as seis.
   */
  /** Só as colunas listadas, em tabelas que outro script já descreveu. */
  function apenasColunas(mapa: Record<string, string[]>): { sql: string; n: number } {
    let sql = ''
    let n = 0
    for (const [tabela, quais] of Object.entries(mapa)) {
      const def = TABELAS[tabela]
      if (!def) continue
      sql += `\n-- ${tabela} (colunas novas)\n`
      for (const c of quais) {
        const texto = def.colunas[c] ?? COMUNS[c]
        if (texto === undefined) {
          faltando.push(`${tabela}.${c}`)
          continue
        }
        sql += `comment on column ${ESQUEMA}.${tabela}.${c} is ${lit(texto)};\n`
        n++
      }
    }
    return { sql, n }
  }

  /** A remocao das colunas avulsas -- so elas, nunca a tabela. */
  function remocoesDeColunas(mapa: Record<string, string[]>): string {
    let r = ''
    for (const [tabela, quais] of Object.entries(mapa)) {
      r += `
-- ${tabela} (colunas novas)
`
      for (const c of quais) r += `comment on column ${ESQUEMA}.${tabela}.${c} is NULL;
`
    }
    return r
  }

  const avulsas = apenasColunas(COLUNAS_NO_SCRIPT_5)
  const cinco = comentarios(NO_SCRIPT_5)
  const cabecalho5 = `-- Portal GD - comentarios das tabelas criadas depois do script 3
--
-- O padrao exige COMMENT na tabela e em TODAS as colunas. Estas seis nasceram
-- depois de 3-cria_comentario.sql ser gerado, e ficaram sem:
--
--   dimensao_gerencia     dimensao_vendedor    fato_venda_vendedor
--   gerencia_variavel     matricula_nivel      vendedor_mes
--
-- Um GMUD nao se reescreve depois de aberto, entao elas vem num script proprio
-- em vez de o 3 ser regerado.
--
-- fato_venda_vendedor tem RETENCAO de 60 dias, tambem exigida pelo padrao para
-- tabela com expurgo: o historico do indicador vive em vendedor_area_mes,
-- consolidado antes de o expurgo alcancar o detalhe.
--
-- Traz tambem as COLUNAS que nasceram depois do 3 em tabelas que ele ja
-- comenta -- usuario, indicador, dimensao_area_venda, fato_venda_linha e
-- ocorrencia_ponto_causa. So as colunas novas: reemitir a tabela inteira faria
-- os dois scripts brigarem pelo mesmo objeto.
--
-- Independente dos scripts 1 a 4: so comenta, nao cria nem altera estrutura.
--
-- Recuperacao: 5-cria_comentario_tabela_restante-RECUPERA.sql
`
  writeFileSync(
    path.join(DESTINO, '5-cria_comentario_tabela_restante.sql'),
    cabecalho5 + cinco.sql + avulsas.sql,
    'utf8',
  )
  writeFileSync(
    path.join(DESTINO, '5-cria_comentario_tabela_restante-RECUPERA.sql'),
    `-- Portal GD - RECUPERA os comentarios do script 5
--
-- COMMENT ... IS NULL e' a forma de apagar; nao existe DROP COMMENT.
${remocoes(NO_SCRIPT_5)}${remocoesDeColunas(COLUNAS_NO_SCRIPT_5)}`,
    'utf8',
  )

  if (regenerarTres) {
    console.log(`  3-cria_comentario.sql            ${n} comentarios`)
    console.log(`  3-cria_comentario-RECUPERA.sql   ${n} remocoes`)
  } else {
    console.log(`  3-cria_comentario.sql            intacto (--regenerar-3 para reescrever)`)
  }
  console.log(`  5-cria_comentario_tabela_restante.sql          ${cinco.n + avulsas.n} comentarios`)
  console.log(`  5-cria_comentario_tabela_restante-RECUPERA.sql ${cinco.n + avulsas.n} remocoes`)
  console.log(`\n  ${Object.keys(TABELAS).length} tabelas/views · ${colunas.length} colunas`)
}

main()
  .catch((e: unknown) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
