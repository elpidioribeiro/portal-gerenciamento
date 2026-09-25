-- Portal GD - comentarios de tabela e coluna
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

-- filial
comment on table public.filial is 'Filiais da Acme Varejo. Cadastro base, veio do handoff do Gerenciamento Diario.';
comment on column public.filial.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.filial.sigla is 'Sigla de tres letras usada nas telas e nas cargas (CEN, NOR, SUL...).';
comment on column public.filial.nome is 'Nome exibido na tela.';
comment on column public.filial.tipo is 'Tipo da unidade. Domino em tipo_filial_type.';
comment on column public.filial.ordem is 'Posicao na exibicao. Menor aparece primeiro.';
comment on column public.filial.ativa is 'Indica se a filial entra nos paineis. Domino: true-SIM false-NAO.';
comment on column public.filial.codigo is 'Codigo numerico da filial no sistema corporativo (cod_empresa). E'' a chave usada para casar com o Oracle.';

-- agrupamento
comment on table public.agrupamento is 'Agrupamentos do quadro de GD: reunem pessoas, pontos de causa e contramedidas por nivel. Chamavam-se "bucket" no handoff.';
comment on column public.agrupamento.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.agrupamento.nivel is 'Nivel hierarquico a que o agrupamento pertence. Domino em nivel_type.';
comment on column public.agrupamento.grupo is 'Grupo do agrupamento, usado so no N4 (ex.: Vendas Construcao). Nulo nos demais.';
comment on column public.agrupamento.nome is 'Nome do agrupamento (Vendas, Suprimentos, Pisos e Revestimentos).';
comment on column public.agrupamento.ordem is 'Posicao na exibicao. Menor aparece primeiro.';

-- usuario
comment on table public.usuario is 'Pessoas com acesso ao portal. O cadastro espelha o sistema corporativo; a senha so existe no modo de desenvolvimento.';
comment on column public.usuario.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.usuario.login_erp is 'Matricula no formato f00000abc. Chave de identificacao da pessoa.';
comment on column public.usuario.nome is 'Nome completo da pessoa.';
comment on column public.usuario.iniciais is 'Tres letras exibidas no avatar da interface.';
comment on column public.usuario.cargo is 'Cargo da pessoa, como consta no sistema corporativo.';
comment on column public.usuario.nivel is 'Nivel resolvido. Usado direto apenas quando id_perfil e'' nulo; havendo perfil, o nivel vem de perfil_nivel a cada requisicao.';
comment on column public.usuario.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.usuario.bucket_id is 'Agrupamento do GD. Referencia agrupamento.id. A coluna manteve o nome antigo: o padrao rege nome de TABELA, e renomear coluna mexeria no codigo sem ganho de conformidade.';
comment on column public.usuario.senha_hash is 'Hash argon2id da senha. Preenchido SO pelo provedor de autenticacao de desenvolvimento; nulo para quem vem da API corporativa, que autentica fora do portal.';
comment on column public.usuario.ativo is 'Indica se a pessoa pode entrar. Domino: true-SIM false-NAO. Falso bloqueia senha, cookie e o atalho de desenvolvimento.';
comment on column public.usuario.id_perfil is 'Perfil no sistema corporativo. E'' a FONTE do nivel: cargo cruzado com lotacao, resolvido a cada requisicao.';
comment on column public.usuario.admin is 'Ve todos os niveis e escolhe qual visualizar. Domino: true-SIM false-NAO. E'' dado, nao codigo: um segundo administrador e'' UPDATE, nao deploy.';

-- perfil_nivel
comment on table public.perfil_nivel is 'Traduz o perfil do sistema corporativo para o nivel do GD. Sem linha aqui, a pessoa e'' bloqueada no login.';
comment on column public.perfil_nivel.nivel is 'Nivel do GD atribuido a este perfil. Domino em nivel_type.';
comment on column public.perfil_nivel.descricao is 'Descricao do perfil, copiada do cadastro corporativo para leitura humana.';
comment on column public.perfil_nivel.ativo is 'Indica se o mapeamento vale. Domino: true-SIM false-NAO.';
comment on column public.perfil_nivel.criado_em is 'Momento em que a linha foi criada.';
comment on column public.perfil_nivel.id_perfil is 'Perfil no sistema corporativo. Chave primaria.';

-- perfil_variavel
comment on table public.perfil_variavel is 'Quais variaveis de controle cada perfil enxerga, por lotacao e empresa. Configurado na tela de administracao.';
comment on column public.perfil_variavel.id_perfil is 'Perfil no sistema corporativo. Parte da chave primaria.';
comment on column public.perfil_variavel.nomloc is 'Lotacao (setor) da pessoa no cadastro corporativo. NAO e'' a filial: o mesmo perfil aparece em lotacoes diferentes.';
comment on column public.perfil_variavel.variavel_controle_id is 'Variavel de controle relacionada. Referencia variavel_controle.id.';
comment on column public.perfil_variavel.criado_em is 'Momento em que a linha foi criada.';
comment on column public.perfil_variavel.cod_empresa is 'Codigo da filial no sistema corporativo. Completa a chave do escopo.';

-- indicador
comment on table public.indicador is 'Os indicadores do GD (Vendas, NPS, Perdas, Custo). Cadastro base, veio do handoff.';
comment on column public.indicador.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.indicador.codigo is 'Codigo curto usado nas rotas e nas cargas (vendas, nps, perdas, custo).';
comment on column public.indicador.nome is 'Nome exibido na tela.';
comment on column public.indicador.unidade is 'Unidade de exibicao do valor (R$, %, pontos).';
comment on column public.indicador.sentido is 'Se numero maior e'' melhor ou pior. Domino em sentido_type. Decide a cor do farol.';
comment on column public.indicador.escala_y is 'Limites do eixo do grafico, em JSON. Ancorado na meta cadastrada.';
comment on column public.indicador.regra_status is 'Regra que decide verde, amarelo ou vermelho, em JSON.';
comment on column public.indicador.ordem is 'Posicao na exibicao. Menor aparece primeiro.';

-- variavel_controle
comment on table public.variavel_controle is 'Variaveis de controle de cada indicador: o nivel abaixo do indicador no ciclo do GD.';
comment on column public.variavel_controle.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.variavel_controle.indicador_id is 'Indicador relacionado. Referencia indicador.id.';
comment on column public.variavel_controle.nome is 'Nome exibido na tela.';
comment on column public.variavel_controle.unidade is 'Unidade de exibicao do valor.';
comment on column public.variavel_controle.sentido is 'Se numero maior e'' melhor ou pior. Domino em sentido_type.';
comment on column public.variavel_controle.ordem is 'Posicao na exibicao. Menor aparece primeiro.';

-- ponto_causa
comment on table public.ponto_causa is 'Pontos de causa de cada variavel de controle. Sao as barras do Pareto e a origem das contramedidas.';
comment on column public.ponto_causa.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.ponto_causa.variavel_controle_id is 'Variavel de controle relacionada. Referencia variavel_controle.id.';
comment on column public.ponto_causa.nome is 'Nome exibido na tela.';
comment on column public.ponto_causa.bucket_id is 'Agrupamento do GD. Referencia agrupamento.id. A coluna manteve o nome antigo: o padrao rege nome de TABELA, e renomear coluna mexeria no codigo sem ganho de conformidade.';
comment on column public.ponto_causa.ordem is 'Posicao na exibicao. Menor aparece primeiro.';
comment on column public.ponto_causa.ativo is 'Indica se o registro esta em uso. Domino: true-SIM false-NAO.';

-- meta
comment on table public.meta is 'Metas mensais, por indicador ou por variavel de controle, por filial.';
comment on column public.meta.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.meta.escopo is 'Se a meta e'' de indicador ou de variavel. Domino em escopo_meta_type.';
comment on column public.meta.alvo_id is 'Identificador do indicador ou da variavel, conforme o escopo.';
comment on column public.meta.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.meta.ano is 'Ano de competencia (2000 a 2100).';
comment on column public.meta.mes is 'Mes de competencia (1 a 12).';
comment on column public.meta.valor is 'Valor da meta no mes, na unidade do alvo.';

-- dimensao_area_venda
comment on table public.dimensao_area_venda is 'Areas de venda por filial. Serve ao detalhamento de Vendas por linha.';
comment on column public.dimensao_area_venda.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.dimensao_area_venda.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.dimensao_area_venda.nome is 'Nome exibido na tela.';
comment on column public.dimensao_area_venda.supervisor is 'Nome do supervisor responsavel pela area.';

-- dimensao_linha
comment on table public.dimensao_linha is 'Linhas de produto por filial. Serve ao detalhamento de Vendas por linha.';
comment on column public.dimensao_linha.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.dimensao_linha.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.dimensao_linha.nome is 'Nome exibido na tela.';
comment on column public.dimensao_linha.area_venda_id is 'Area de venda a que a linha pertence. Referencia dimensao_area_venda.id.';

-- fato_venda
comment on table public.fato_venda is 'Vendas por filial e dia. Substituida por janela a cada carga: o periodo declarado e'' apagado e regravado.';
comment on column public.fato_venda.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.fato_venda.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.fato_venda.data is 'Dia a que o valor se refere, na data da ORIGEM (D-1 em relacao a carga).';
comment on column public.fato_venda.valor_real is 'Valor realizado no dia, como vem da origem.';
comment on column public.fato_venda.sync_id is 'Execucao de carga que gravou esta linha. Referencia execucao_sincronizacao.id, e permite rastrear de onde veio cada numero.';
comment on column public.fato_venda.atualizado_em is 'Momento da ultima gravacao desta linha pela ingestao.';
comment on column public.fato_venda.tendencia is 'Projecao do fechamento do mes, calculada na origem.';
comment on column public.fato_venda.delta_meta is 'Desvio percentual da tendencia sobre a meta, calculado na origem. Nulo quando a origem nao envia; nesse caso o portal calcula pela meta cadastrada.';

-- fato_venda_linha
comment on table public.fato_venda_linha is 'Vendas por filial, dia e linha de produto. Detalhamento do indicador de Vendas.';
comment on column public.fato_venda_linha.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.fato_venda_linha.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.fato_venda_linha.data is 'Dia a que o valor se refere, na data da ORIGEM (D-1 em relacao a carga).';
comment on column public.fato_venda_linha.linha_id is 'Linha de produto. Referencia dimensao_linha.id.';
comment on column public.fato_venda_linha.valor is 'Valor vendido na linha, no dia.';
comment on column public.fato_venda_linha.sync_id is 'Execucao de carga que gravou esta linha. Referencia execucao_sincronizacao.id, e permite rastrear de onde veio cada numero.';
comment on column public.fato_venda_linha.atualizado_em is 'Momento da ultima gravacao desta linha pela ingestao.';

-- fato_nps
comment on table public.fato_nps is 'Respostas de NPS por filial e dia. O indice e'' calculado na leitura, nao armazenado, para nao existir em dois lugares.';
comment on column public.fato_nps.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.fato_nps.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.fato_nps.data is 'Dia a que o valor se refere, na data da ORIGEM (D-1 em relacao a carga).';
comment on column public.fato_nps.qtd_promotores is 'Quantidade de respostas promotoras (notas 9 e 10).';
comment on column public.fato_nps.qtd_neutros is 'Quantidade de respostas neutras (notas 7 e 8).';
comment on column public.fato_nps.qtd_detratores is 'Quantidade de respostas detratoras (notas 0 a 6).';
comment on column public.fato_nps.sync_id is 'Execucao de carga que gravou esta linha. Referencia execucao_sincronizacao.id, e permite rastrear de onde veio cada numero.';
comment on column public.fato_nps.atualizado_em is 'Momento da ultima gravacao desta linha pela ingestao.';

-- fato_perda
comment on table public.fato_perda is 'Perdas por filial, dia e tipo de quebra. Carregada por consulta direta ao Oracle desde 22/08/2026.';
comment on column public.fato_perda.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.fato_perda.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.fato_perda.data is 'Dia a que o valor se refere, na data da ORIGEM (D-1 em relacao a carga).';
comment on column public.fato_perda.tipo_quebra is 'QI (quebra identificada) ou QNI (nao identificada). Domino em tipo_quebra_type.';
comment on column public.fato_perda.status is 'Situacao da quebra. Domino em status_quebra_type. So APROVADA entra no indicador.';
comment on column public.fato_perda.valor is 'Valor contabil da perda, COM O SINAL DA ORIGEM. Nenhum sinal esta associado a um tipo: QI e QNI podem vir positivas ou negativas.';
comment on column public.fato_perda.sync_id is 'Execucao de carga que gravou esta linha. Referencia execucao_sincronizacao.id, e permite rastrear de onde veio cada numero.';
comment on column public.fato_perda.atualizado_em is 'Momento da ultima gravacao desta linha pela ingestao.';

-- fato_movimentacao
comment on table public.fato_movimentacao is 'Movimentacao (base de calculo de Perdas % Mov) por filial e dia. Carregada por consulta direta ao Oracle.';
comment on column public.fato_movimentacao.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.fato_movimentacao.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.fato_movimentacao.data is 'Dia a que o valor se refere, na data da ORIGEM (D-1 em relacao a carga).';
comment on column public.fato_movimentacao.valor is 'Valor movimentado no dia.';
comment on column public.fato_movimentacao.sync_id is 'Execucao de carga que gravou esta linha. Referencia execucao_sincronizacao.id, e permite rastrear de onde veio cada numero.';
comment on column public.fato_movimentacao.atualizado_em is 'Momento da ultima gravacao desta linha pela ingestao.';

-- fato_custo
comment on table public.fato_custo is 'Custo por filial e competencia. Lancamento manual; ainda sem origem automatica.';
comment on column public.fato_custo.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.fato_custo.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.fato_custo.ano is 'Ano de competencia (2000 a 2100).';
comment on column public.fato_custo.mes is 'Mes de competencia (1 a 12).';
comment on column public.fato_custo.valor is 'Valor do custo na competencia.';
comment on column public.fato_custo.lancado_por_id is 'Pessoa que fez o lancamento. Referencia usuario.id.';
comment on column public.fato_custo.lancado_em is 'Momento do lancamento.';
comment on column public.fato_custo.atualizado_em is 'Momento da ultima gravacao desta linha pela ingestao.';

-- fato_variavel_controle
comment on table public.fato_variavel_controle is 'Valores das variaveis de controle por filial e dia. Guarda numerador e denominador, nao o resultado.';
comment on column public.fato_variavel_controle.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.fato_variavel_controle.variavel_controle_id is 'Variavel de controle relacionada. Referencia variavel_controle.id.';
comment on column public.fato_variavel_controle.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.fato_variavel_controle.data is 'Dia a que o valor se refere, na data da ORIGEM (D-1 em relacao a carga).';
comment on column public.fato_variavel_controle.numerador is 'Numerador do calculo da variavel.';
comment on column public.fato_variavel_controle.denominador is 'Denominador do calculo. Guardar os dois em vez do resultado permite somar periodos corretamente.';
comment on column public.fato_variavel_controle.sync_id is 'Execucao de carga que gravou esta linha. Referencia execucao_sincronizacao.id, e permite rastrear de onde veio cada numero.';
comment on column public.fato_variavel_controle.atualizado_em is 'Momento da ultima gravacao desta linha pela ingestao.';

-- ocorrencia_ponto_causa
comment on table public.ocorrencia_ponto_causa is 'Marcacoes de ponto de causa. Cada linha e'' uma ocorrencia apontada por alguem, e o Pareto e'' a contagem delas.';
comment on column public.ocorrencia_ponto_causa.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.ocorrencia_ponto_causa.ponto_causa_id is 'Ponto de causa relacionado. Referencia ponto_causa.id.';
comment on column public.ocorrencia_ponto_causa.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.ocorrencia_ponto_causa.registrado_por_id is 'Pessoa que marcou a ocorrencia. Referencia usuario.id.';
comment on column public.ocorrencia_ponto_causa.registrado_em is 'Momento da marcacao.';
comment on column public.ocorrencia_ponto_causa.observacao is 'Texto livre do que foi observado. Opcional.';

-- contramedida
comment on table public.contramedida is 'Contramedidas abertas a partir de um ponto de causa. E'' o fim do ciclo do GD: indicador, variavel, ponto de causa, contramedida.';
comment on column public.contramedida.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.contramedida.codigo is 'Codigo legivel no formato AC-0000. Sequencial apenas para leitura humana.';
comment on column public.contramedida.titulo is 'Titulo curto da contramedida.';
comment on column public.contramedida.pdc_ref is 'Referencia ao PDC (plano de acao) de origem, quando houver.';
comment on column public.contramedida.ponto_causa_id is 'Ponto de causa relacionado. Referencia ponto_causa.id.';
comment on column public.contramedida.variavel_controle_id is 'Variavel de controle relacionada. Referencia variavel_controle.id.';
comment on column public.contramedida.indicador_id is 'Indicador relacionado. Referencia indicador.id.';
comment on column public.contramedida.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.contramedida.nivel_atual is 'Nivel onde a contramedida esta agora. Domino em nivel_type. Muda quando ela e'' escalada.';
comment on column public.contramedida.bucket_id is 'Agrupamento do GD. Referencia agrupamento.id. A coluna manteve o nome antigo: o padrao rege nome de TABELA, e renomear coluna mexeria no codigo sem ganho de conformidade.';
comment on column public.contramedida.responsavel_atual_id is 'Pessoa responsavel neste momento. Referencia usuario.id.';
comment on column public.contramedida.criado_por_id is 'Pessoa que abriu a contramedida. Referencia usuario.id.';
comment on column public.contramedida.criado_em is 'Momento em que a linha foi criada.';
comment on column public.contramedida.prazo is 'Data limite acordada para a conclusao.';
comment on column public.contramedida.prioridade is 'Prioridade atribuida. Domino em prioridade_type.';
comment on column public.contramedida.concluida_em is 'Momento da conclusao. Nulo enquanto estiver aberta.';
comment on column public.contramedida.comentario_abertura is 'Texto escrito na abertura, explicando o problema.';
comment on column public.contramedida.origem is 'De onde a contramedida nasceu (marcacao de Pareto, reuniao, auditoria).';

-- movimentacao
comment on table public.movimentacao is 'Historico de movimentacoes de uma contramedida: escalada, mudanca de responsavel, prorrogacao, conclusao.';
comment on column public.movimentacao.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.movimentacao.contramedida_id is 'Contramedida a que este registro pertence. Referencia contramedida.id.';
comment on column public.movimentacao.tipo is 'Tipo da movimentacao. Domino em tipo_movimentacao_type.';
comment on column public.movimentacao.autor_id is 'Pessoa que fez a movimentacao. Referencia usuario.id.';
comment on column public.movimentacao.criado_em is 'Momento em que a linha foi criada.';
comment on column public.movimentacao.nivel_origem is 'Nivel de onde saiu. Domino em nivel_type.';
comment on column public.movimentacao.nivel_destino is 'Nivel para onde foi. Domino em nivel_type.';
comment on column public.movimentacao.bucket_destino_id is 'Agrupamento de destino. Referencia agrupamento.id.';
comment on column public.movimentacao.responsavel_destino_id is 'Novo responsavel. Referencia usuario.id.';
comment on column public.movimentacao.motivo is 'Motivo declarado da movimentacao.';
comment on column public.movimentacao.texto is 'Texto livre complementar.';
comment on column public.movimentacao.novo_prazo is 'Prazo novo, quando a movimentacao for prorrogacao.';
comment on column public.movimentacao.resultado_indicador is 'Resultado do indicador na conclusao. Domino em resultado_indicador_type.';

-- comentario
comment on table public.comentario is 'Comentarios escritos numa contramedida.';
comment on column public.comentario.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.comentario.contramedida_id is 'Contramedida a que este registro pertence. Referencia contramedida.id.';
comment on column public.comentario.autor_id is 'Pessoa que escreveu. Referencia usuario.id.';
comment on column public.comentario.criado_em is 'Momento em que a linha foi criada.';
comment on column public.comentario.texto is 'Conteudo do comentario.';

-- execucao_sincronizacao
comment on table public.execucao_sincronizacao is 'Registro de cada carga de dados: o que entrou, quando, de onde e com que resultado. RETENCAO: 12 meses.';
comment on column public.execucao_sincronizacao.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.execucao_sincronizacao.fonte is 'Fonte carregada (vendas, nps, perdas, movimentacao, metas).';
comment on column public.execucao_sincronizacao.iniciado_em is 'Momento em que a carga comecou.';
comment on column public.execucao_sincronizacao.finalizado_em is 'Momento em que terminou. Nulo enquanto estiver rodando.';
comment on column public.execucao_sincronizacao.status is 'Resultado da execucao. Domino em status_sync_type.';
comment on column public.execucao_sincronizacao.periodo_de is 'Primeiro dia da janela substituida por esta carga.';
comment on column public.execucao_sincronizacao.periodo_ate is 'Ultimo dia da janela substituida por esta carga.';
comment on column public.execucao_sincronizacao.linhas_recebidas is 'Quantas linhas chegaram no lote.';
comment on column public.execucao_sincronizacao.linhas_gravadas is 'Quantas linhas foram efetivamente gravadas.';
comment on column public.execucao_sincronizacao.linhas_removidas is 'Quantas linhas a substituicao de janela apagou antes de gravar.';
comment on column public.execucao_sincronizacao.erro is 'Mensagem do erro, quando a carga falhou. Nulo em caso de sucesso.';
comment on column public.execucao_sincronizacao.origem_ip is 'IP de quem enviou a carga. Distingue o n8n de uma execucao manual.';

-- carga_agendamento
comment on table public.carga_agendamento is 'Horario de carga por fonte, editavel na tela. Linha presente sobrepoe o padrao do codigo; ausencia significa usar o padrao.';
comment on column public.carga_agendamento.fonte is 'Fonte cujo horario esta sendo sobreposto. Chave primaria.';
comment on column public.carga_agendamento.hora is 'Hora de disparo, 0 a 23.';
comment on column public.carga_agendamento.minuto is 'Minuto de disparo, 0 a 59.';
comment on column public.carga_agendamento.atualizado_em is 'Momento da ultima alteracao do horario.';
comment on column public.carga_agendamento.atualizado_por is 'Pessoa que alterou o horario. Referencia usuario.id.';

-- renovacao_sessao
comment on table public.renovacao_sessao is 'Tokens de renovacao de sessao. Guardam apenas o hash, nunca o token. RETENCAO: 30 dias apos expirar.';
comment on column public.renovacao_sessao.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.renovacao_sessao.usuario_id is 'Dono da sessao. Referencia usuario.id.';
comment on column public.renovacao_sessao.token_hash is 'Hash do token de renovacao. O token em si NUNCA e'' gravado.';
comment on column public.renovacao_sessao.familia_id is 'Agrupa as renovacoes sucessivas de uma mesma sessao. Permite revogar a cadeia inteira ao detectar reuso.';
comment on column public.renovacao_sessao.expira_em is 'Momento em que o token deixa de valer.';
comment on column public.renovacao_sessao.revogado_em is 'Momento da revogacao. Nulo enquanto valido.';
comment on column public.renovacao_sessao.user_agent is 'Identificacao do navegador que abriu a sessao.';
comment on column public.renovacao_sessao.ip is 'Endereco IP de origem da requisicao.';
comment on column public.renovacao_sessao.criado_em is 'Momento em que a linha foi criada.';

-- log_auditoria
comment on table public.log_auditoria is 'Trilha de auditoria das alteracoes: quem fez, o que, quando e de onde. RETENCAO: 24 meses.';
comment on column public.log_auditoria.id is 'Identificador da linha. Chave primaria, UUID v4 gerado pela aplicacao.';
comment on column public.log_auditoria.usuario_id is 'Pessoa que executou a acao. Referencia usuario.id. Nulo em acao do sistema.';
comment on column public.log_auditoria.acao is 'Acao executada (criacao, alteracao, exclusao).';
comment on column public.log_auditoria.entidade is 'Tabela afetada pela acao.';
comment on column public.log_auditoria.entidade_id is 'Identificador da linha afetada.';
comment on column public.log_auditoria.payload is 'Conteudo da alteracao, em JSON.';
comment on column public.log_auditoria.ip is 'Endereco IP de origem da requisicao.';
comment on column public.log_auditoria.criado_em is 'Momento em que a linha foi criada.';

-- vw_tipo_perda
comment on view public.vw_tipo_perda is 'Desdobramento de Perdas por tipo de quebra. VIEW e nao tabela de proposito: fato_perda ja guarda estes campos, e uma copia poderia divergir.';
comment on column public.vw_tipo_perda.filial_id is 'Filial a que o registro pertence. Referencia filial.id.';
comment on column public.vw_tipo_perda.data is 'Dia a que o valor se refere, na data da ORIGEM (D-1 em relacao a carga).';
comment on column public.vw_tipo_perda.tipo is 'Tipo da quebra: QI (identificada) ou QNI (nao identificada).';
comment on column public.vw_tipo_perda.valor is 'Valor contabil da perda, com o sinal da origem.';
