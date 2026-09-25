import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * ESLint 9, config flat.
 *
 * `npm run lint` estava no `package.json` desde o começo e nunca rodou — não
 * havia config, e o comando morria pedindo migração. Um CI que roda lint
 * quebraria no primeiro job; foi achado da estação 5 da esteira.
 *
 * O conjunto é `strictTypeChecked`, o mesmo rigor do `tsconfig` (que já tem
 * `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes`). Escolher um
 * conjunto mais frouxo que o compilador daria a falsa sensação de rede dupla.
 *
 * As desativações abaixo são poucas e cada uma tem motivo escrito. Regra
 * desligada sem justificativa é dívida invisível: ninguém sabe se ainda faz
 * sentido, e reativar depois vira uma tarde de correções.
 */
export default tseslint.config(
  {
    // Nada de lintar saída de build nem dependência.
    ignores: ['dist/**', 'node_modules/**', 'src/fontes/**', 'prisma/migrations/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /**
       * O projeto usa `!` em lugares onde o índice é comprovadamente válido —
       * `filiais.get(l.filial)!` depois de `mapearFiliais`, que já falha se
       * faltar. `noUncheckedIndexedAccess` do tsconfig obriga a lidar com o
       * `undefined`, e o `!` é a forma de dizer "aqui já foi verificado".
       * Proibi-lo trocaria asserção explícita por `if` morto ou `?? throw`.
       */
      '@typescript-eslint/no-non-null-assertion': 'off',

      /**
       * `void promessa` é intencional e documentado nos dois lugares em que
       * aparece: o disparo de carga que não espera (a rota devolve 202) e o
       * `setTimeout` do agendamento. A regra existe para pegar promessa
       * esquecida; o `void` é justamente a marca de que não foi esquecimento.
       */
      '@typescript-eslint/no-confusing-void-expression': 'off',

      /**
       * As mensagens de erro interpolam valores de tipos variados de propósito
       * (`${e.codEmpresa}`, `${idPerfil}`) — o objetivo é a mensagem dizer o
       * número, e `String()` em volta de cada um só adicionaria ruído.
       */
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],

      /** Argumento não usado com `_` na frente é a convenção do projeto. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      /**
       * `async` sem `await` é obrigatório aqui, não descuido.
       *
       * O Fastify define plugin e conjunto de rotas como função que devolve
       * promessa (`FastifyPluginAsync`) e a aguarda no `register`. Toda função
       * `xRoutes`/`xPlugin` do projeto é async por contrato, e várias não
       * precisam de `await` no corpo. Nos testes vale o mesmo para os mocks:
       * `vi.fn(async () => …)` precisa devolver promessa para casar com a
       * assinatura real.
       *
       * Mantê-la ligada produziria 19 erros que só se calam removendo o `async`
       * que a biblioteca exige — trocaria ruído por defeito.
       */
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    /**
     * `src/fontes/fontes.mjs` e os scripts `.mjs` não entram no projeto do
     * TypeScript, então as regras que precisam de tipo não têm o que ler ali —
     * o parser reclama de "not found by the project service" antes de qualquer
     * regra rodar. Lint sem tipo, que é o que cabe.
     */
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // `projectService: false` desfaz o do bloco anterior, que não tem `files` e
      // por isso alcança tudo. Sem isto o parser procura o `.mjs` no projeto do
      // TypeScript, não acha, e falha antes de qualquer regra rodar.
      parserOptions: { projectService: false, project: null },
      // Sem checagem de tipo, o `no-undef` volta a valer — e ele não sabe que
      // `process` e `console` existem no Node. Nos arquivos `.ts` quem cobre
      // isso é o próprio TypeScript.
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  {
    // Testes: o `expect` aceita `any` do JSON de resposta, e exigir tipo em cada
    // asserção transformaria teste em exercício de tipagem.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
)
