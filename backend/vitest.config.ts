// Carrega o .env antes de qualquer teste — a URL do banco de teste vem de
// DATABASE_URL_TEST, ou é derivada da DATABASE_URL quando aquela não existe.
// Evita depender do binário do dotenv-cli no script do npm.
import 'dotenv/config'
import { defineConfig } from 'vitest/config'
import { urlDeTeste } from './tests/setup/banco.js'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    /**
     * 30 s, não os 10 s padrão.
     *
     * O `beforeAll` dos testes de integração abre a primeira conexão do processo
     * com o Postgres, e num banco que acabou de subir isso passa de 10 segundos —
     * medido: a suíte falhou uma vez logo após `npm run db:start`, e passou na
     * repetição sem nenhuma mudança de código.
     *
     * No CI o serviço de banco também sobe do zero a cada execução, então o
     * padrão produziria teste intermitente — o pior tipo de vermelho, porque
     * ninguém confia nem quando é verdadeiro.
     */
    hookTimeout: 30_000,
    // Os testes que leem do banco compartilham o mesmo cluster local; rodar em
    // paralelo geraria contenção sem ganho, dado o tamanho da suíte.
    fileParallelism: false,
    // Cria/recria `portalgd_test` com migrations + seed antes do primeiro teste.
    globalSetup: ['./tests/setup/global.ts'],
    env: {
      NODE_ENV: 'test',
      // A troca da DATABASE_URL acontece AQUI, não dentro dos testes: assim
      // vale para qualquer `new PrismaClient()` da suíte, inclusive os criados
      // dentro do código de produção que os testes exercitam. Um teste que
      // esquecesse de apontar para o banco de teste escreveria no banco real —
      // exatamente o defeito que esta separação existe para eliminar.
      DATABASE_URL: urlDeTeste(),

      /**
       * Oracle apagado de propósito, mesmo que o `.env` tenha credencial.
       *
       * Este arquivo carrega o `.env` inteiro para achar a URL do banco, e com
       * isso as variáveis do Oracle chegavam na suíte. Quando o `.env` passou a
       * ter credencial de verdade, os testes das travas de leitura pararam de
       * exercitar a trava e começaram a **abrir conexão com o banco da
       * empresa**: `consultarUma('SELECT 1 FROM DUAL')` devolveu `{ '1': 1 }`.
       *
       * Só leitura, sem estrago — mas suíte que depende do Oracle no ar falha no
       * CI, falha fora da rede e mede a rede em vez de medir o código. Vazio
       * porque `obterPool` testa por valor falsy; string em branco é tratada
       * como ausente e a recusa acontece antes de qualquer socket.
       *
       * Quem for testar a consulta real usa script (`scripts/`), não a suíte.
       */
      /**
       * Provider fixado, pelo mesmo motivo do Oracle logo abaixo.
       *
       * Com `erp` herdado do `.env`, a validação de ambiente passa a exigir a
       * conexão com o Oracle — que esta mesma configuração apaga de propósito —
       * e o boot morre em TODO arquivo que constrói a app. Doze arquivos
       * quebraram assim no dia em que o desenvolvimento passou a usar a API de
       * login de verdade.
       *
       * A suíte não testa o provider corporativo: ele depende de rede e de
       * credencial de gente. O que ela testa é o caminho de dentro.
       */
      AUTH_PROVIDER: 'mock',

      ORACLE_USER: '',
      ORACLE_PASSWORD: '',
      ORACLE_CONNECT_STRING: '',

      /**
       * Sessão da suíte fixada, pelo mesmo motivo do Oracle acima.
       *
       * Os testes de integração injetam requisição sem cookie e contam com o
       * bypass para serem atendidos. Herdando do `.env`, a suíte quebra de duas
       * formas silenciosas: com `AUTH_DEV_BYPASS=false` tudo vira 401, e com um
       * `AUTH_DEV_USUARIO` que o seed não cria — o que aconteceu quando o
       * desenvolvimento passou a usar o administrador real — o usuário não
       * existe no banco de teste e o erro aparece longe da causa.
       *
       * `f00001mle` é criado pelo seed e é N2, o nível de v1.
       */
      AUTH_DEV_BYPASS: 'true',
      AUTH_DEV_USUARIO: 'f00001mle',

      /**
       * Segredos de teste, fixados — a suíte não pode depender de um `.env`.
       *
       * `validarEnv` exige `JWT_SECRET` e `INGEST_TOKEN` com pelo menos 32
       * caracteres, e o boot morre sem eles. Aqui eles chegavam de carona: este
       * arquivo carrega o `.env` para achar a URL do banco, e o `.env` tinha os
       * dois. Na máquina do analista, portanto, tudo passava.
       *
       * No runner não existe `.env` — ele não é versionado, e não deve ser. O
       * resultado foi **11 arquivos de teste caindo na importação**, com o erro
       * a três saltos da causa: `Cannot read properties of undefined (reading
       * 'close')`, porque o `beforeAll` morreu antes de criar a app e o
       * `afterAll` rodou assim mesmo.
       *
       * A correção óbvia seria declarar as duas no `.gitlab-ci.yml`. Seria pior:
       * manteria a suíte dependente de ambiente externo, só mudando de qual. Um
       * teste tem de rodar em qualquer máquina com o repositório e um Postgres.
       *
       * Valores fixos e evidentemente de teste. Não são segredo: assinam token
       * de um banco descartável que o seed recria a cada execução. Escrever
       * `SEGREDO` no meio serve para que, se um dia vazarem para um log de
       * produção, a origem seja óbvia.
       */
      JWT_SECRET: 'SEGREDO-DE-TESTE-NAO-USAR-EM-PRODUCAO-0123456789',
      INGEST_TOKEN: 'TOKEN-DE-TESTE-NAO-USAR-EM-PRODUCAO-0123456789',
    },
  },
})
