-- Situação do vendedor no mês: SITAFA, HOUVE_VENDA e a COTA.
--
-- Ver PLANO §7.14. Substitui `vendedor-mes.sql`.
--
-- Grão: (empresa, vendedor, ano, mês). **Não é achatável em (empresa,
-- vendedor)**, e é a única das quatro que não é: `HOUVE_VENDA` classifica o
-- vendedor NUM MÊS -- quem foi "COM VENDA" em julho pode ser "SEM VENDA" em
-- agosto, e quem virou supervisor virou supervisor a partir de um mês.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ `HOUVE_VENDA` É CALCULADA COM `SYSDATE`. RECARREGAR IMPORTA.              │
-- │                                                                           │
-- │ Enquanto o mês corre, todo mundo é "MÊS EM VIGOR" -- ninguém é julgado    │
-- │ por um mês pela metade. Quando o mês fecha, a MESMA linha passa a ser     │
-- │ "COM VENDA" ou "SEM VENDA".                                               │
-- │                                                                           │
-- │ Ou seja: **o rótulo gravado ontem pode estar errado hoje**. A carga tem   │
-- │ de reescrever o mês corrente todo dia E reescrever o mês anterior pelo    │
-- │ menos uma vez depois de fechado. Uma carga só-inserção congela agosto     │
-- │ inteiro como "MÊS EM VIGOR", e aí o denominador de Performance Vendedor   │
-- │ nunca mais muda -- sem erro nenhum, com número plausível na tela.         │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- A ORDEM DAS PERGUNTAS É A REGRA. É um CASE, e a primeira que casa vence. Um
-- supervisor inativo no mês corrente é 'SEM VENDA' pela primeira condição e
-- nunca chega a 'SUPERVISOR'. Reordenar muda o número sem dar erro.
--
-- A COTA VEM JUNTO, e não numa quinta consulta, porque tem exatamente este grão:
-- (empresa, vendedor, ano, mês). É o denominador de "bateu a meta" e não existe
-- em lugar nenhum além de `VENDA163` -- sem ela Performance Vendedor não fecha.
--
-- `VLR_VND_MES` NÃO VEM. O realizado é `vendedor-dia.sql`, somado pelo portal.
-- Trazer os dois criaria dois números para o mesmo fato, calculados por regras
-- diferentes (LIQUIDA aqui, mensal ali), sem pista de qual está certo. Ele
-- aparece abaixo só DENTRO do CASE, porque a classificação depende dele.
--
-- SEM `HR_USUARIO_FILIAIS`. A versão anterior passava por ela para chegar à
-- matrícula; `AGTV.MATRICULA` dá o mesmo, direto, e a ponte deixou de existir.
-- Uma junção a menos.

SELECT V.COD_EMPRESA                        AS COD_EMPRESA
     , V.ANO_VND                            AS ANO
     , V.MES_VND                            AS MES
     , V.COD_VENDEDOR                       AS COD_VENDEDOR
     , A.MATRICULA                          AS MATRICULA
     , NVL(V.COTA_MENSAL, 0)                AS META
     /*
      * Situação funcional. 7 é quem não está trabalhando.
      *
      * Conta GENÉRICA ("VENDA BALCÃO" e afins) é forçada a ativa, como no BI:
      * não é pessoa, não tem matrícula, não tem SITAFA -- e sem isso cairia em 7
      * e pareceria uma pessoa desligada.
      */
     , CASE WHEN A.NOME LIKE '%VENDA%' THEN 1
            ELSE NVL(C.SITAFA, 7)
       END                                  AS SITAFA
     , CASE
         /*
          * 1ª: inativo no mês corrente. Vence tudo, inclusive supervisor.
          */
         WHEN V.ANO_VND  = EXTRACT(YEAR  FROM SYSDATE)
          AND V.MES_VND  = EXTRACT(MONTH FROM SYSDATE)
          AND A.NOME NOT LIKE '%VENDA%'
          AND NVL(C.SITAFA, 7) = 7
           THEN 'SEM VENDA'
         /*
          * 2ª: supervisor daquele mês. Tem código de vendedor, mas não é medido
          * por cota individual -- categoria própria, nem numerador nem
          * denominador.
          */
         WHEN EXISTS ( SELECT 1
                         FROM ERP_SUP_AREA_HISTORICO H
                        WHERE H.SUPERVISOR = V.COD_VENDEDOR
                          AND TO_NUMBER(TO_CHAR(H.DT_INICIO, 'MM')) = V.MES_VND
                          AND TO_CHAR(H.DT_INICIO, 'RRRR')          = V.ANO_VND )
           THEN 'SUPERVISOR'
         /*
          * 3ª: quem caiu em TELEVENDAS sem ser vendedor de televendas. A área
          * existe no cadastro comercial e não é área de loja; quem cai ali por
          * engano não é vendedor de piso e não deve pesar no denominador de
          * ninguém.
          */
         WHEN AV.DESCRICAO = 'TELEVENDAS'
          AND NVL(C.TITRED, ' ') <> 'VENDEDOR TELEVENDAS'
           THEN 'SEM VENDA'
         -- 4ª: mês ainda correndo. Não se julga mês pela metade.
         WHEN V.ANO_VND = EXTRACT(YEAR  FROM SYSDATE)
          AND V.MES_VND = EXTRACT(MONTH FROM SYSDATE)
           THEN 'MÊS EM VIGOR'
         -- 5ª: mês fechado. Aqui, e só aqui, o realizado decide.
         WHEN NVL(V.VLR_VND_MES, 0) > 0 THEN 'COM VENDA'
         ELSE 'SEM VENDA'
       END                                  AS HOUVE_VENDA
  FROM VENDA163 V
  /*
   * AGTV com a regra de empresa corporativa: quando `COD_EMPRESA_CORP` existe, é
   * ela que vale. Sem isso o vendedor apareceria em duas filiais.
   */
  JOIN ( SELECT A1.*
           FROM AGTV A1
          WHERE A1.COD_EMPRESA = NVL(A1.COD_EMPRESA_CORP, A1.COD_EMPRESA)
       ) A
    ON A.COD_EMPRESA = V.COD_EMPRESA
   AND A.CODIGO      = V.COD_VENDEDOR
  /*
   * LEFT, diferente de `vendedor-area.sql`. Lá o INNER é o filtro que define
   * quem pertence à área; aqui a área serve só para a regra de TELEVENDAS, e um
   * INNER faria o vendedor sem área cadastrada DESAPARECER da situação
   * funcional -- some do denominador sem nada acusar. Sem área, a 3ª condição
   * não dispara e a classificação segue o caminho normal.
   */
  /*
   * INNER, e com o mesmo recorte de `vendedor-area.sql`: só área de
   * TIPO_AREA 'C' ou 'N'.
   *
   * Era LEFT, e a primeira carga real mostrou o custo: existe um terceiro tipo,
   * `'I'` -- 24 áreas e 225 vendedores nas nove lojas, entre elas TELEVENDAS,
   * VENDA DIRETA, BANHEIRAS e LANCHONETE. Elas não têm gerente adjunto no GD, e
   * ficam de fora por decisão do analista (27/08/2026).
   *
   * AS DUAS CONSULTAS TÊM DE CONCORDAR sobre quem é vendedor. Com LEFT aqui, 65
   * vendedores apareciam na situação e não no cadastro, e a ingestão recusava o
   * lote inteiro. É a mesma regra que fez o `99` sair dos dois lados: uma
   * exclusão que existe num lado e não no outro não gera erro -- gera número.
   */
  JOIN ERP.ERP_AREA_VENDA AV
    ON AV.CD_AREA    = A.AREA_VENDA
   AND AV.CD_EMPRESA = A.COD_EMPRESA
   AND AV.TIPO_AREA  IN ('C', 'N')
  /*
   * A situação funcional e o cargo vêm da MESMA view que o login usa. LEFT: o
   * vendedor que não está lá é conta genérica (tratada acima) ou cadastro
   * incompleto -- e cair para SITAFA 7 é a leitura conservadora.
   */
  LEFT JOIN HR_VW_COLABORADORES C
    ON C.NUMCAD = A.MATRICULA
 /*
  * Janela como :de / :ate, a mesma convenção das outras fontes, recortada por
  * MÊS INTEIRO -- o grão daqui é competência, e meio mês não existe.
  */
 WHERE TO_DATE(V.ANO_VND || '-' || V.MES_VND || '-01', 'YYYY-MM-DD')
       BETWEEN TRUNC(TO_DATE(:de,  'YYYY-MM-DD'), 'MM')
           AND TRUNC(TO_DATE(:ate, 'YYYY-MM-DD'), 'MM')
   /*
    * ┌─────────────────────────────────────────────────────────────────────┐
    * │ O 99 TEM DE SAIR AQUI TAMBÉM, E ISSO NÃO É SIMETRIA COSMÉTICA.      │
    * │                                                                     │
    * │ `vendedor-dia.sql` exclui `CODVEND <> '99'` -- é o código de venda   │
    * │ sem vendedor identificado. Medido no example-cluster (27/08/2026): o 99 é      │
    * │ "VENDA DIRETA" e tem COTA_MENSAL de **14.130.000** -- a meta da      │
    * │ loja estacionada numa conta genérica, não a meta de uma pessoa.      │
    * │                                                                     │
    * │ Sem este filtro ele entra no denominador (SITAFA 1, COM VENDA,       │
    * │ META > 0) com realizado ZERO, porque o fato o exclui. Resultado:     │
    * │ um "vendedor" de 14 milhões que nunca bate meta, puxando a área      │
    * │ inteira para baixo todo mês, com número plausível na tela.           │
    * └─────────────────────────────────────────────────────────────────────┘
    */
   AND V.COD_VENDEDOR <> 99
   /*
    * AS 9 LOJAS DO GD, por inclusão. Ver o comentário longo em
    * `vendas-linha.sql`: `siglaDoCodigo` devolve string vazia para código que
    * não conhece, e a ingestão recusa o lote inteiro. Filtrar aqui é a mesma
    * decisão já tomada no NPS.
    */
   AND V.COD_EMPRESA IN (1, 2, 3, 4, 5, 6, 7, 8, 9)
 ORDER BY 1, 2, 3, 4
