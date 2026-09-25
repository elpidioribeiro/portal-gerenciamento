-- Adequacao ao padrao de nomenclatura da empresa.
--
-- Mesmo conteudo dos scripts de GMUD em docs/gmud/, que sao os artefatos do
-- processo de mudanca. Aqui para que um banco novo - producao - nasca ja no
-- padrao, sem depender de alguem lembrar de rodar o script.
--
-- RENAME nao move dado: altera o nome no catalogo. As linhas ficam onde estao.

-- Recuperacao: 1-renomeia_objetos_portal_gd-RECUPERA.sql

-- Tabelas
ALTER TABLE public.fato_perdas RENAME TO fato_perda;
ALTER TABLE public.fato_vendas RENAME TO fato_venda;
ALTER TABLE public.fato_vendas_linha RENAME TO fato_venda_linha;
ALTER TABLE public.audit_log RENAME TO log_auditoria;
ALTER TABLE public.refresh_token RENAME TO renovacao_sessao;
ALTER TABLE public.sync_execucao RENAME TO execucao_sincronizacao;
ALTER TABLE public.bucket RENAME TO agrupamento;
ALTER TABLE public.dim_area_venda RENAME TO dimensao_area_venda;
ALTER TABLE public.dim_linha RENAME TO dimensao_linha;

-- Chaves primarias
ALTER TABLE public.log_auditoria RENAME CONSTRAINT audit_log_pkey TO log_auditoria_PK;
ALTER TABLE public.agrupamento RENAME CONSTRAINT bucket_pkey TO agrupamento_PK;
ALTER TABLE public.carga_agendamento RENAME CONSTRAINT carga_agendamento_pkey TO carga_agendamento_PK;
ALTER TABLE public.comentario RENAME CONSTRAINT comentario_pkey TO comentario_PK;
ALTER TABLE public.contramedida RENAME CONSTRAINT contramedida_pkey TO contramedida_PK;
ALTER TABLE public.dimensao_area_venda RENAME CONSTRAINT dim_area_venda_pkey TO dimensao_area_venda_PK;
ALTER TABLE public.dimensao_linha RENAME CONSTRAINT dim_linha_pkey TO dimensao_linha_PK;
ALTER TABLE public.fato_custo RENAME CONSTRAINT fato_custo_pkey TO fato_custo_PK;
ALTER TABLE public.fato_movimentacao RENAME CONSTRAINT fato_movimentacao_pkey TO fato_movimentacao_PK;
ALTER TABLE public.fato_nps RENAME CONSTRAINT fato_nps_pkey TO fato_nps_PK;
ALTER TABLE public.fato_perda RENAME CONSTRAINT fato_perdas_pkey TO fato_perda_PK;
ALTER TABLE public.fato_variavel_controle RENAME CONSTRAINT fato_variavel_controle_pkey TO fato_variavel_controle_PK;
ALTER TABLE public.fato_venda RENAME CONSTRAINT fato_vendas_pkey TO fato_venda_PK;
ALTER TABLE public.fato_venda_linha RENAME CONSTRAINT fato_vendas_linha_pkey TO fato_venda_linha_PK;
ALTER TABLE public.filial RENAME CONSTRAINT filial_pkey TO filial_PK;
ALTER TABLE public.indicador RENAME CONSTRAINT indicador_pkey TO indicador_PK;
ALTER TABLE public.meta RENAME CONSTRAINT meta_pkey TO meta_PK;
ALTER TABLE public.movimentacao RENAME CONSTRAINT movimentacao_pkey TO movimentacao_PK;
ALTER TABLE public.ocorrencia_ponto_causa RENAME CONSTRAINT ocorrencia_ponto_causa_pkey TO ocorrencia_ponto_causa_PK;
ALTER TABLE public.perfil_nivel RENAME CONSTRAINT perfil_nivel_pkey TO perfil_nivel_PK;
ALTER TABLE public.perfil_variavel RENAME CONSTRAINT perfil_variavel_pkey TO perfil_variavel_PK;
ALTER TABLE public.ponto_causa RENAME CONSTRAINT ponto_causa_pkey TO ponto_causa_PK;
ALTER TABLE public.renovacao_sessao RENAME CONSTRAINT refresh_token_pkey TO renovacao_sessao_PK;
ALTER TABLE public.execucao_sincronizacao RENAME CONSTRAINT sync_execucao_pkey TO execucao_sincronizacao_PK;
ALTER TABLE public.usuario RENAME CONSTRAINT usuario_pkey TO usuario_PK;
ALTER TABLE public.variavel_controle RENAME CONSTRAINT variavel_controle_pkey TO variavel_controle_PK;

-- Chaves estrangeiras
ALTER TABLE public.log_auditoria RENAME CONSTRAINT audit_log_usuario_id_fkey TO log_auditoria_usuario_FK;
ALTER TABLE public.carga_agendamento RENAME CONSTRAINT carga_agendamento_atualizado_por_fkey TO carga_agendamento_usuario_FK;
ALTER TABLE public.comentario RENAME CONSTRAINT comentario_autor_id_fkey TO comentario_usuario_FK;
ALTER TABLE public.comentario RENAME CONSTRAINT comentario_contramedida_id_fkey TO comentario_contramedida_FK;
ALTER TABLE public.contramedida RENAME CONSTRAINT contramedida_bucket_id_fkey TO contramedida_agrupamento_FK;
ALTER TABLE public.contramedida RENAME CONSTRAINT contramedida_criado_por_id_fkey TO contramedida_usuario01_FK;
ALTER TABLE public.contramedida RENAME CONSTRAINT contramedida_filial_id_fkey TO contramedida_filial_FK;
ALTER TABLE public.contramedida RENAME CONSTRAINT contramedida_indicador_id_fkey TO contramedida_indicador_FK;
ALTER TABLE public.contramedida RENAME CONSTRAINT contramedida_ponto_causa_id_fkey TO contramedida_ponto_causa_FK;
ALTER TABLE public.contramedida RENAME CONSTRAINT contramedida_responsavel_atual_id_fkey TO contramedida_usuario02_FK;
ALTER TABLE public.contramedida RENAME CONSTRAINT contramedida_variavel_controle_id_fkey TO contramedida_variavel_controle_FK;
ALTER TABLE public.dimensao_area_venda RENAME CONSTRAINT dim_area_venda_filial_id_fkey TO dimensao_area_venda_filial_FK;
ALTER TABLE public.dimensao_linha RENAME CONSTRAINT dim_linha_area_venda_id_fkey TO dimensao_linha_dimensao_area_venda_FK;
ALTER TABLE public.dimensao_linha RENAME CONSTRAINT dim_linha_filial_id_fkey TO dimensao_linha_filial_FK;
ALTER TABLE public.fato_custo RENAME CONSTRAINT fato_custo_filial_id_fkey TO fato_custo_filial_FK;
ALTER TABLE public.fato_custo RENAME CONSTRAINT fato_custo_lancado_por_id_fkey TO fato_custo_usuario_FK;
ALTER TABLE public.fato_movimentacao RENAME CONSTRAINT fato_movimentacao_filial_id_fkey TO fato_movimentacao_filial_FK;
ALTER TABLE public.fato_movimentacao RENAME CONSTRAINT fato_movimentacao_sync_id_fkey TO fato_movimentacao_execucao_sincronizacao_FK;
ALTER TABLE public.fato_nps RENAME CONSTRAINT fato_nps_filial_id_fkey TO fato_nps_filial_FK;
ALTER TABLE public.fato_nps RENAME CONSTRAINT fato_nps_sync_id_fkey TO fato_nps_execucao_sincronizacao_FK;
ALTER TABLE public.fato_perda RENAME CONSTRAINT fato_perdas_filial_id_fkey TO fato_perda_filial_FK;
ALTER TABLE public.fato_perda RENAME CONSTRAINT fato_perdas_sync_id_fkey TO fato_perda_execucao_sincronizacao_FK;
ALTER TABLE public.fato_variavel_controle RENAME CONSTRAINT fato_variavel_controle_filial_id_fkey TO fato_variavel_controle_filial_FK;
ALTER TABLE public.fato_variavel_controle RENAME CONSTRAINT fato_variavel_controle_sync_id_fkey TO fato_variavel_controle_execucao_sincronizacao_FK;
ALTER TABLE public.fato_variavel_controle RENAME CONSTRAINT fato_variavel_controle_variavel_controle_id_fkey TO fato_variavel_controle_variavel_controle_FK;
ALTER TABLE public.fato_venda RENAME CONSTRAINT fato_vendas_filial_id_fkey TO fato_venda_filial_FK;
ALTER TABLE public.fato_venda RENAME CONSTRAINT fato_vendas_sync_id_fkey TO fato_venda_execucao_sincronizacao_FK;
ALTER TABLE public.fato_venda_linha RENAME CONSTRAINT fato_vendas_linha_filial_id_fkey TO fato_venda_linha_filial_FK;
ALTER TABLE public.fato_venda_linha RENAME CONSTRAINT fato_vendas_linha_linha_id_fkey TO fato_venda_linha_dimensao_linha_FK;
ALTER TABLE public.fato_venda_linha RENAME CONSTRAINT fato_vendas_linha_sync_id_fkey TO fato_venda_linha_execucao_sincronizacao_FK;
ALTER TABLE public.meta RENAME CONSTRAINT meta_filial_id_fkey TO meta_filial_FK;
ALTER TABLE public.movimentacao RENAME CONSTRAINT movimentacao_autor_id_fkey TO movimentacao_usuario01_FK;
ALTER TABLE public.movimentacao RENAME CONSTRAINT movimentacao_bucket_destino_id_fkey TO movimentacao_agrupamento_FK;
ALTER TABLE public.movimentacao RENAME CONSTRAINT movimentacao_contramedida_id_fkey TO movimentacao_contramedida_FK;
ALTER TABLE public.movimentacao RENAME CONSTRAINT movimentacao_responsavel_destino_id_fkey TO movimentacao_usuario02_FK;
ALTER TABLE public.ocorrencia_ponto_causa RENAME CONSTRAINT ocorrencia_ponto_causa_filial_id_fkey TO ocorrencia_ponto_causa_filial_FK;
ALTER TABLE public.ocorrencia_ponto_causa RENAME CONSTRAINT ocorrencia_ponto_causa_ponto_causa_id_fkey TO ocorrencia_ponto_causa_ponto_causa_FK;
ALTER TABLE public.ocorrencia_ponto_causa RENAME CONSTRAINT ocorrencia_ponto_causa_registrado_por_id_fkey TO ocorrencia_ponto_causa_usuario_FK;
ALTER TABLE public.perfil_variavel RENAME CONSTRAINT perfil_variavel_variavel_controle_id_fkey TO perfil_variavel_variavel_controle_FK;
ALTER TABLE public.ponto_causa RENAME CONSTRAINT ponto_causa_bucket_id_fkey TO ponto_causa_agrupamento_FK;
ALTER TABLE public.ponto_causa RENAME CONSTRAINT ponto_causa_variavel_controle_id_fkey TO ponto_causa_variavel_controle_FK;
ALTER TABLE public.renovacao_sessao RENAME CONSTRAINT refresh_token_usuario_id_fkey TO renovacao_sessao_usuario_FK;
ALTER TABLE public.usuario RENAME CONSTRAINT usuario_bucket_id_fkey TO usuario_agrupamento_FK;
ALTER TABLE public.usuario RENAME CONSTRAINT usuario_filial_id_fkey TO usuario_filial_FK;
ALTER TABLE public.variavel_controle RENAME CONSTRAINT variavel_controle_indicador_id_fkey TO variavel_controle_indicador_FK;

-- Constraints de check
ALTER TABLE public.carga_agendamento RENAME CONSTRAINT carga_agendamento_hora_valida TO carga_agendamento_CK01;
ALTER TABLE public.carga_agendamento RENAME CONSTRAINT carga_agendamento_minuto_valido TO carga_agendamento_CK02;

-- Unicidade (o Prisma cria @@unique como indice unico)
ALTER INDEX public.bucket_nivel_nome_key RENAME TO agrupamento_UK01;
ALTER INDEX public.contramedida_codigo_key RENAME TO contramedida_UK01;
ALTER INDEX public.dim_area_venda_filial_id_nome_key RENAME TO dimensao_area_venda_UK01;
ALTER INDEX public.dim_linha_filial_id_nome_key RENAME TO dimensao_linha_UK01;
ALTER INDEX public.fato_custo_filial_id_ano_mes_key RENAME TO fato_custo_UK01;
ALTER INDEX public.fato_movimentacao_filial_id_data_key RENAME TO fato_movimentacao_UK01;
ALTER INDEX public.fato_nps_filial_id_data_key RENAME TO fato_nps_UK01;
ALTER INDEX public.fato_perdas_filial_id_data_tipo_quebra_status_key RENAME TO fato_perda_UK01;
ALTER INDEX public.fato_variavel_controle_variavel_controle_id_filial_id_data_key RENAME TO fato_variavel_controle_UK01;
ALTER INDEX public.fato_vendas_filial_id_data_key RENAME TO fato_venda_UK01;
ALTER INDEX public.fato_vendas_linha_filial_id_data_linha_id_key RENAME TO fato_venda_linha_UK01;
ALTER INDEX public.filial_codigo_key RENAME TO filial_UK01;
ALTER INDEX public.filial_sigla_key RENAME TO filial_UK02;
ALTER INDEX public.indicador_codigo_key RENAME TO indicador_UK01;
ALTER INDEX public.meta_escopo_alvo_id_filial_id_ano_mes_key RENAME TO meta_UK01;
ALTER INDEX public.ponto_causa_variavel_controle_id_nome_key RENAME TO ponto_causa_UK01;
ALTER INDEX public.refresh_token_token_hash_key RENAME TO renovacao_sessao_UK01;
ALTER INDEX public.usuario_login_erp_key RENAME TO usuario_UK01;
ALTER INDEX public.variavel_controle_indicador_id_nome_key RENAME TO variavel_controle_UK01;

-- Indices
ALTER INDEX public.audit_log_criado_em_idx RENAME TO log_auditoria_IDX01;
ALTER INDEX public.audit_log_entidade_entidade_id_idx RENAME TO log_auditoria_IDX02;
ALTER INDEX public.comentario_contramedida_id_criado_em_idx RENAME TO comentario_IDX01;
ALTER INDEX public.contramedida_criado_em_idx RENAME TO contramedida_IDX01;
ALTER INDEX public.contramedida_nivel_atual_filial_id_idx RENAME TO contramedida_IDX02;
ALTER INDEX public.contramedida_responsavel_atual_id_idx RENAME TO contramedida_IDX03;
ALTER INDEX public.fato_movimentacao_data_idx RENAME TO fato_movimentacao_IDX01;
ALTER INDEX public.fato_nps_data_idx RENAME TO fato_nps_IDX01;
ALTER INDEX public.fato_perdas_data_idx RENAME TO fato_perda_IDX01;
ALTER INDEX public.fato_variavel_controle_data_idx RENAME TO fato_variavel_controle_IDX01;
ALTER INDEX public.fato_vendas_data_idx RENAME TO fato_venda_IDX01;
ALTER INDEX public.fato_vendas_linha_data_idx RENAME TO fato_venda_linha_IDX01;
ALTER INDEX public.meta_filial_id_ano_mes_idx RENAME TO meta_IDX01;
ALTER INDEX public.movimentacao_contramedida_id_criado_em_idx RENAME TO movimentacao_IDX01;
ALTER INDEX public.ocorrencia_ponto_causa_ponto_causa_id_filial_id_registrado__idx RENAME TO ocorrencia_ponto_causa_IDX01;
ALTER INDEX public.perfil_nivel_nivel_idx RENAME TO perfil_nivel_IDX01;
ALTER INDEX public.perfil_variavel_escopo_idx RENAME TO perfil_variavel_IDX01;
ALTER INDEX public.refresh_token_familia_id_idx RENAME TO renovacao_sessao_IDX01;
ALTER INDEX public.refresh_token_usuario_id_idx RENAME TO renovacao_sessao_IDX02;
ALTER INDEX public.sync_execucao_fonte_status_iniciado_em_idx RENAME TO execucao_sincronizacao_IDX01;
ALTER INDEX public.usuario_id_perfil_idx RENAME TO usuario_IDX01;
ALTER INDEX public.usuario_nivel_idx RENAME TO usuario_IDX02;

-- Tipos (enums)
ALTER TYPE public."EscopoMeta" RENAME TO escopo_meta_type;
ALTER TYPE public."Nivel" RENAME TO nivel_type;
ALTER TYPE public."Prioridade" RENAME TO prioridade_type;
ALTER TYPE public."ResultadoIndicador" RENAME TO resultado_indicador_type;
ALTER TYPE public."Sentido" RENAME TO sentido_type;
ALTER TYPE public."StatusQuebra" RENAME TO status_quebra_type;
ALTER TYPE public."StatusSync" RENAME TO status_sync_type;
ALTER TYPE public."TipoFilial" RENAME TO tipo_filial_type;
ALTER TYPE public."TipoMovimentacao" RENAME TO tipo_movimentacao_type;
ALTER TYPE public."TipoQuebra" RENAME TO tipo_quebra_type;

-- Owner das tabelas (regra especifica de Postgres)
ALTER TABLE public.log_auditoria OWNER TO CURRENT_USER;
ALTER TABLE public.agrupamento OWNER TO CURRENT_USER;
ALTER TABLE public.carga_agendamento OWNER TO CURRENT_USER;
ALTER TABLE public.comentario OWNER TO CURRENT_USER;
ALTER TABLE public.contramedida OWNER TO CURRENT_USER;
ALTER TABLE public.dimensao_area_venda OWNER TO CURRENT_USER;
ALTER TABLE public.dimensao_linha OWNER TO CURRENT_USER;
ALTER TABLE public.fato_custo OWNER TO CURRENT_USER;
ALTER TABLE public.fato_movimentacao OWNER TO CURRENT_USER;
ALTER TABLE public.fato_nps OWNER TO CURRENT_USER;
ALTER TABLE public.fato_perda OWNER TO CURRENT_USER;
ALTER TABLE public.fato_variavel_controle OWNER TO CURRENT_USER;
ALTER TABLE public.fato_venda OWNER TO CURRENT_USER;
ALTER TABLE public.fato_venda_linha OWNER TO CURRENT_USER;
ALTER TABLE public.filial OWNER TO CURRENT_USER;
ALTER TABLE public.indicador OWNER TO CURRENT_USER;
ALTER TABLE public.meta OWNER TO CURRENT_USER;
ALTER TABLE public.movimentacao OWNER TO CURRENT_USER;
ALTER TABLE public.ocorrencia_ponto_causa OWNER TO CURRENT_USER;
ALTER TABLE public.perfil_nivel OWNER TO CURRENT_USER;
ALTER TABLE public.perfil_variavel OWNER TO CURRENT_USER;
ALTER TABLE public.ponto_causa OWNER TO CURRENT_USER;
ALTER TABLE public.renovacao_sessao OWNER TO CURRENT_USER;
ALTER TABLE public.execucao_sincronizacao OWNER TO CURRENT_USER;
ALTER TABLE public.usuario OWNER TO CURRENT_USER;
ALTER TABLE public.variavel_controle OWNER TO CURRENT_USER;

-- Um indice por chave estrangeira, como o padrao exige.

--
-- Recuperacao: 2-cria_indice_chave_estrangeira-RECUPERA.sql

CREATE INDEX log_auditoria_IDX03 ON public.log_auditoria (usuario_id);
CREATE INDEX carga_agendamento_IDX01 ON public.carga_agendamento (atualizado_por);
CREATE INDEX comentario_IDX02 ON public.comentario (autor_id);
CREATE INDEX comentario_IDX03 ON public.comentario (contramedida_id);
CREATE INDEX contramedida_IDX04 ON public.contramedida (bucket_id);
CREATE INDEX contramedida_IDX05 ON public.contramedida (criado_por_id);
CREATE INDEX contramedida_IDX06 ON public.contramedida (filial_id);
CREATE INDEX contramedida_IDX07 ON public.contramedida (indicador_id);
CREATE INDEX contramedida_IDX08 ON public.contramedida (ponto_causa_id);
CREATE INDEX contramedida_IDX09 ON public.contramedida (responsavel_atual_id);
CREATE INDEX contramedida_IDX10 ON public.contramedida (variavel_controle_id);
CREATE INDEX dimensao_area_venda_IDX01 ON public.dimensao_area_venda (filial_id);
CREATE INDEX dimensao_linha_IDX01 ON public.dimensao_linha (area_venda_id);
CREATE INDEX dimensao_linha_IDX02 ON public.dimensao_linha (filial_id);
CREATE INDEX fato_custo_IDX01 ON public.fato_custo (filial_id);
CREATE INDEX fato_custo_IDX02 ON public.fato_custo (lancado_por_id);
CREATE INDEX fato_movimentacao_IDX02 ON public.fato_movimentacao (filial_id);
CREATE INDEX fato_movimentacao_IDX03 ON public.fato_movimentacao (sync_id);
CREATE INDEX fato_nps_IDX02 ON public.fato_nps (filial_id);
CREATE INDEX fato_nps_IDX03 ON public.fato_nps (sync_id);
CREATE INDEX fato_perda_IDX02 ON public.fato_perda (filial_id);
CREATE INDEX fato_perda_IDX03 ON public.fato_perda (sync_id);
CREATE INDEX fato_variavel_controle_IDX02 ON public.fato_variavel_controle (filial_id);
CREATE INDEX fato_variavel_controle_IDX03 ON public.fato_variavel_controle (sync_id);
CREATE INDEX fato_variavel_controle_IDX04 ON public.fato_variavel_controle (variavel_controle_id);
CREATE INDEX fato_venda_IDX02 ON public.fato_venda (filial_id);
CREATE INDEX fato_venda_IDX03 ON public.fato_venda (sync_id);
CREATE INDEX fato_venda_linha_IDX02 ON public.fato_venda_linha (filial_id);
CREATE INDEX fato_venda_linha_IDX03 ON public.fato_venda_linha (linha_id);
CREATE INDEX fato_venda_linha_IDX04 ON public.fato_venda_linha (sync_id);
CREATE INDEX meta_IDX02 ON public.meta (filial_id);
CREATE INDEX movimentacao_IDX02 ON public.movimentacao (autor_id);
CREATE INDEX movimentacao_IDX03 ON public.movimentacao (bucket_destino_id);
CREATE INDEX movimentacao_IDX04 ON public.movimentacao (contramedida_id);
CREATE INDEX movimentacao_IDX05 ON public.movimentacao (responsavel_destino_id);
CREATE INDEX ocorrencia_ponto_causa_IDX02 ON public.ocorrencia_ponto_causa (filial_id);
CREATE INDEX ocorrencia_ponto_causa_IDX03 ON public.ocorrencia_ponto_causa (ponto_causa_id);
CREATE INDEX ocorrencia_ponto_causa_IDX04 ON public.ocorrencia_ponto_causa (registrado_por_id);
CREATE INDEX perfil_variavel_IDX02 ON public.perfil_variavel (variavel_controle_id);
CREATE INDEX ponto_causa_IDX01 ON public.ponto_causa (bucket_id);
CREATE INDEX ponto_causa_IDX02 ON public.ponto_causa (variavel_controle_id);
CREATE INDEX renovacao_sessao_IDX03 ON public.renovacao_sessao (usuario_id);
CREATE INDEX usuario_IDX03 ON public.usuario (bucket_id);
CREATE INDEX usuario_IDX04 ON public.usuario (filial_id);
CREATE INDEX variavel_controle_IDX01 ON public.variavel_controle (indicador_id);
