-- Cadastro: quem é o SUPERVISOR de cada área de venda.
--
-- Dimensão. Ver PLANO §7.14.
--
-- Grão: (empresa, área de venda). É quem apresenta a área na reunião do N4.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ UMA CORREÇÃO NO ORIGINAL, E ELA MUDA O RESULTADO                          │
-- │                                                                           │
-- │ A consulta do analista tem:                                               │
-- │                                                                           │
-- │     left join erp_area_venda av                                           │
-- │       on av.cd_area    = ssa.cd_area                                       │
-- │      and av.cd_empresa = av.cd_empresa       ← compara consigo mesma       │
-- │                                                                           │
-- │ `av.cd_empresa = av.cd_empresa` é sempre verdadeiro. Na prática o join    │
-- │ acontece SÓ por `cd_area`, atravessando as empresas: cada linha de        │
-- │ `ERP_SUP_AREA` casa com a área de mesmo código em TODAS as filiais.       │
-- │                                                                           │
-- │ Duas consequências, e nenhuma dá erro:                                    │
-- │                                                                           │
-- │   * O resultado MULTIPLICA -- uma linha por filial que tenha aquele       │
-- │     código. Com 9 filiais, 9 linhas onde devia haver 1.                   │
-- │   * A DESCRIÇÃO pode vir de outra loja. Se CEN e LIT numeram as áreas     │
-- │     diferente, o supervisor de CEN aparece rotulado com a área de LIT.    │
-- │                                                                           │
-- │ Aqui está `av.cd_empresa = ssa.cd_empresa`. Se a sua conferência foi      │
-- │ feita contra o número da consulta original, ela vai divergir -- e é essa  │
-- │ que está certa.                                                           │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- O NOME VEM DE `NOMFUN`, não de `AGTV.NOME`. São coisas diferentes: `AGTV` é
-- cadastro de conta de venda e o nome ali pode ser rótulo comercial; `NOMFUN` é
-- o nome da pessoa no cadastro de colaborador. Quem apresenta a área na reunião
-- é a pessoa.
--
-- `SUPERVISOR` é um `CD_USUARIO`, e a ponte até a matrícula é
-- `HR_USUARIO_FILIAIS` -- a mesma tabela que eu havia evitado por supor que
-- guardasse senha. Não guarda (ver §7.14).
--
-- A MATRÍCULA VEM JUNTO, e não é enfeite: é por ela que o supervisor pode ser
-- ligado ao usuário do portal, se um dia ele tiver login.
--
-- `TIPO_AREA IN ('C','N')` -- só Construção e Não Construção. É o mesmo par que
-- `vendas-linha.sql` e `metas-area-venda.sql` traduzem em gerência, e área de
-- outro tipo não tem gerência adjunta no GD.
--
-- ELE TRANSFORMA O `LEFT JOIN` DE `ERP_AREA_VENDA` EM `INNER`, e por isso está
-- escrito como INNER aqui: filtrar por coluna da tabela à direita descarta
-- justamente as linhas em que ela veio nula. São a mesma consulta -- a
-- diferença é que `INNER` diz o que acontece, e `LEFT ... WHERE` esconde.
--
-- Consequência, e é a que interessa: **supervisor de área que não está em
-- `ERP_AREA_VENDA` daquela empresa some da carga.** Antes da correção do join
-- acima isso quase nunca acontecia (a área casava com qualquer empresa); agora
-- acontece, e é o comportamento certo.

SELECT SSA.CD_EMPRESA                       AS COD_EMPRESA
     -- A chave: `vendedor-area.sql` chega aqui por (COD_EMPRESA, CD_AREA).
     , SSA.CD_AREA                          AS CD_AREA
     , AV.DESCRICAO                         AS AREA_VENDA
     , CASE AV.TIPO_AREA
         WHEN 'C' THEN 'CONSTRUÇÃO'
         WHEN 'N' THEN 'NÃO CONSTRUÇÃO'
       END                                  AS GERENCIA
     , SSA.SUPERVISOR                       AS COD_SUPERVISOR
     , US.MATRICULA                         AS MATRICULA
     , VW.NOMFUN                            AS SUPERVISOR
  FROM ERP.ERP_SUP_AREA SSA
  /*
   * INNER, e não LEFT: o filtro `TIPO_AREA IN ('C','N')` já descartaria toda
   * linha em que esta tabela viesse nula. Ver o cabeçalho.
   */
  JOIN ERP.ERP_AREA_VENDA AV
    ON AV.CD_AREA    = SSA.CD_AREA
   AND AV.CD_EMPRESA = SSA.CD_EMPRESA
   AND AV.TIPO_AREA  IN ('C', 'N')
  /*
   * Estes dois seguem LEFT, e é a decisão certa: a área existe mesmo sem
   * colaborador casado, e é justamente isso que a tela precisa mostrar. INNER
   * faria a área SUMIR do quadro do N4 por falta de cadastro de pessoa -- some
   * a área, some o número dela, e ninguém pergunta pelo que não está na tela.
   */
  /*
   * A ponte AGRUPADA, e não a tabela crua.
   *
   * `HR_USUARIO_FILIAIS` tem cadastro DUPLICADO: medido em 27/08/2026, o
   * supervisor 24474 da empresa 3 aparece em duas linhas para a mesma empresa,
   * com a MESMA matrícula. Sem o agrupamento a consulta devolvia duas linhas
   * para (SUL, área 6) e (SUL, área 7), e a ingestão recusou o lote inteiro por
   * chave repetida -- que é o comportamento certo dela.
   *
   * `MIN` porque a matrícula é a mesma nas duplicatas (conferido: 1 distinta
   * por par). Se um dia houver duas de verdade, `MIN` escolhe sempre a mesma --
   * determinístico, e não "a primeira que o banco devolver".
   */
  LEFT JOIN ( SELECT CD_USUARIO, CD_EMPRESA, MIN(MATRICULA) AS MATRICULA
                FROM ERP.HR_USUARIO_FILIAIS
               GROUP BY CD_USUARIO, CD_EMPRESA ) US
    ON US.CD_USUARIO = SSA.SUPERVISOR
   AND US.CD_EMPRESA = SSA.CD_EMPRESA
  LEFT JOIN HR_VW_COLABORADORES VW
    ON VW.NUMCAD = US.MATRICULA
 ORDER BY 1, 2
