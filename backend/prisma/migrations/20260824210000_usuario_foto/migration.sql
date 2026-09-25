-- Foto do colaborador, como a API de login devolve.
--
-- TEXT e nao VARCHAR com limite: a API documenta o campo como "URL/base64", e
-- base64 de uma foto passa de qualquer limite razoavel que se escolha. Nulo e'
-- o caso comum - quem nao tem foto cadastrada continua exibindo as iniciais.

ALTER TABLE public.usuario ADD COLUMN foto TEXT;

comment on column public.usuario.foto is
'Foto do colaborador vinda da API de login: URL ou base64. Nula quando nao ha foto cadastrada - a tela cai para as iniciais.';
