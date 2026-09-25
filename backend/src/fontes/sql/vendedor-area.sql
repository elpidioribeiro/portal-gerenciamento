-- Cadastro: qual é a ÁREA DE VENDA de cada vendedor.
--
-- Dimensão, não fato. Ver PLANO §7.14.
--
-- Grão: (empresa, vendedor). Uma linha por vendedor cadastrado.
--
-- POR QUE SEPARADA DO FATO: se a área viesse junto com a venda diária, cada dia
-- da janela gravaria a área VIGENTE NO MOMENTO DA CARGA -- e o vendedor
-- transferido levaria consigo, retroativamente, toda a venda que ele fez na área
-- antiga. Separando, a venda antiga fica onde aconteceu e só o cadastro muda.
--
-- A ÁREA VEM DO CADASTRO, NÃO DO QUE FOI VENDIDO. Um vendedor de Pisos que vende
-- um item de Metais continua sendo vendedor de Pisos. Repartir a venda dele
-- entre áreas faria "quantos bateram meta" deixar de ser contável -- meta é da
-- PESSOA, e pessoa não se divide.
--
-- A GERÊNCIA VEM DE GRAÇA, de `TIPO_AREA` -- o mesmo mapeamento de
-- `vendas-linha.sql` e `metas-area-venda.sql`. É o que liga o vendedor ao
-- gerente adjunto sem precisar de um quarto cadastro.
--
-- NÃO TRAZ HISTÓRICO. A consulta do analista tem `MV_VENDEDOR_AREA_HIST`, com a
-- área do vendedor POR MÊS (`NVL(H.AREA_VENDA, A.AREA_VENDA)`). Ficou de fora
-- porque a tela pergunta pela área de HOJE, e trazer histórico mudaria o grão
-- desta consulta de (empresa, vendedor) para (empresa, vendedor, mês).
-- Consequência aceita: o Pareto de um mês fechado mostra o vendedor na área
-- atual dele, não na de então. Se isso incomodar, o histórico entra aqui e o
-- grão ganha ano/mês.

SELECT A.COD_EMPRESA                        AS COD_EMPRESA
     , A.CODIGO                             AS COD_VENDEDOR
     -- Nula em conta genérica. Ver o comentário em `vendedor-dia.sql`.
     , A.MATRICULA                          AS MATRICULA
     , A.NOME                                AS NOME
     /*
      * O CÓDIGO da área é a chave da junção com `area-supervisor.sql`, não a
      * descrição. Descrição é rótulo: pode ser reescrita no cadastro sem que
      * nada aponte para ela, e aí o vendedor perde o supervisor em silêncio.
      */
     , AV.CD_AREA                           AS CD_AREA
     , AV.DESCRICAO                         AS AREA_VENDA
     , CASE AV.TIPO_AREA
         WHEN 'C' THEN 'CONSTRUÇÃO'
         WHEN 'N' THEN 'NÃO CONSTRUÇÃO'
       END                                  AS GERENCIA
  FROM AGTV A
  /*
   * INNER, como nas outras consultas de área: vendedor sem área cadastrada fica
   * de fora. Aqui a consequência é mais suave que em vendas -- ele não entra no
   * denominador de área nenhuma, em vez de sumir de um total que precisa fechar.
   */
  JOIN ERP.ERP_AREA_VENDA AV
    ON AV.CD_AREA    = A.AREA_VENDA
   AND AV.CD_EMPRESA = A.COD_EMPRESA
   /*
    * Só área com gerência: o portal exige `gerencia_id` na dimensão, e área de
    * outro TIPO_AREA não tem gerente adjunto no GD. Mesmo filtro de
    * `area-supervisor.sql`.
    */
   AND AV.TIPO_AREA IN ('C', 'N')
 /*
  * Empresa corporativa: quando `COD_EMPRESA_CORP` existe, é ela que vale. Sem
  * isso o vendedor apareceria em duas filiais. Reproduz o que a consulta do BI
  * faz na subconsulta de AGTV.
  */
 WHERE A.COD_EMPRESA = NVL(A.COD_EMPRESA_CORP, A.COD_EMPRESA)
   /*
    * AS 9 LOJAS DO GD, por inclusão. Ver o comentário longo em
    * `vendas-linha.sql`: `siglaDoCodigo` devolve string vazia para código que
    * não conhece, e a ingestão recusa o lote inteiro. Filtrar aqui é a mesma
    * decisão já tomada no NPS.
    */
   AND A.COD_EMPRESA IN (1, 2, 3, 4, 5, 6, 7, 8, 9)
 ORDER BY 1, 2
