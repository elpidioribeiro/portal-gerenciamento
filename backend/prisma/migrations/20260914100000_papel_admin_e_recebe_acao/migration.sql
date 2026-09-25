-- Duas perguntas que o cadastro nao sabia responder.
--
-- Ate aqui `usuario.admin` respondia uma so': administra ou nao. Faltavam:
--
--   1. QUEM ADMINISTRA QUEM ADMINISTRA. Um administrador comum faz tudo na
--      area, menos escolher quem mais entra nela. Sem esse degrau, conceder
--      acesso e' transitivo -- qualquer admin cria outro, e revoga quem o criou.
--
--   2. SE TRABALHO PODE CAIR NA MAO DA PESSOA. Quem administra o portal sem
--      participar do GD ve o quadro do N2 e nao e' N2: nao entra na lista de
--      destinatarios, nao recebe escalacao nem direcionamento.
--
-- Pedido do analista em 14/09/2026.
--
-- UMA COLUNA PARA O PAPEL, e nao duas booleanas (`admin` + `master`). Duas
-- permitiriam gravar master que nao e' admin -- estado sem significado que
-- alguem teria de lembrar de impedir em todo lugar que escreve. Com o tipo
-- enumerado ele nao existe.
--
-- A ANCORA NAO MORA AQUI. A matricula 10001 e' MASTER por codigo
-- (src/modules/auth/papel-admin.ts calcula o papel em vez de le-lo), e o valor
-- desta coluna nao a alcanca. E' a trava que impede o estado irreversivel: o
-- ultimo master se revoga e nao existe tela capaz de desfazer, porque conceder
-- papel exige um master. O UPDATE abaixo grava MASTER na linha dela assim mesmo,
-- para o catalogo concordar com o que vale -- nao para o codigo depender disso.
--
-- SEM PERDA DE DADO. Os dois UPDATE rodam antes do DROP, na mesma transacao:
-- quem era `admin = true` sai daqui como ADMIN (ou MASTER, se for a ancora), e
-- todo o resto como NENHUM, que e' o default.
--
-- Recuperacao: a GMUD tem o par. Desfazer exige recriar `admin` boolean,
-- traduzir de volta (`papel_admin <> 'NENHUM'` -> true) e derrubar o tipo.

CREATE TYPE public.papel_admin_type AS ENUM ('NENHUM', 'ADMIN', 'MASTER');

ALTER TABLE public.usuario
  ADD COLUMN papel_admin public.papel_admin_type NOT NULL DEFAULT 'NENHUM',
  ADD COLUMN recebe_acao boolean NOT NULL DEFAULT true;

-- A ancora primeiro, para o segundo UPDATE nao a rebaixar a ADMIN.
UPDATE public.usuario SET papel_admin = 'MASTER' WHERE admin = true AND matricula = 10001;
UPDATE public.usuario SET papel_admin = 'ADMIN'  WHERE admin = true AND papel_admin = 'NENHUM';

ALTER TABLE public.usuario DROP COLUMN admin;

CREATE INDEX usuario_idx05 ON public.usuario (papel_admin);

COMMENT ON COLUMN public.usuario.papel_admin IS 'Papel de administracao do portal. Dominio: NENHUM-nao administra, ADMIN-administra tudo na area, MASTER-administra e concede ou revoga o papel dos outros.';
COMMENT ON COLUMN public.usuario.recebe_acao IS 'Indica se a cadeia de ajuda pode entregar contramedida a esta pessoa. Falso em quem administra o portal sem participar do GD. Dominio: true-SIM false-NAO.';
