import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * ESLint 9, config flat — o par do `backend/eslint.config.js`.
 *
 * `npm run lint` existia no `package.json` do frontend e **nunca rodou**: não
 * havia config, e o comando morria em *"couldn't find eslint.config.js"*. O
 * backend ganhou o dele na estação 5 da esteira; este lado ficou para trás, e
 * ficar para trás em silêncio é o padrão: o script está lá, quem roda vê um
 * erro de ferramenta e não uma lista de problemas, e conclui que "o lint está
 * quebrado" em vez de "o código não passa".
 *
 * O conjunto é `strictTypeChecked`, o MESMO do backend e o mesmo rigor do
 * `tsconfig` (que já tem `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
 * `noUnusedLocals` e `noUnusedParameters`). Dois lados do mesmo produto com
 * réguas diferentes é o começo de duas culturas de código.
 *
 * Sobre o que NÃO está aqui: não há `eslint-plugin-react-hooks`. Ele pega uma
 * classe de defeito que nada neste projeto pega hoje — hook chamado dentro de
 * condição, dependência faltando em `useEffect` —, mas entra como decisão
 * própria, não de carona numa correção de ferramenta: `exhaustive-deps` acusa
 * dezenas de casos e consertar dependência muda comportamento em tempo de
 * execução.
 */
export default tseslint.config(
  {
    // Nada de lintar saída de build nem dependência.
    ignores: ['dist/**', 'node_modules/**', 'src/types/api.d.ts'],
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
       * Mesma razão do backend: o projeto usa `!` onde o índice é
       * comprovadamente válido, e `noUncheckedIndexedAccess` obriga a lidar com
       * o `undefined`. Proibir o `!` trocaria asserção explícita por `if` morto.
       */
      '@typescript-eslint/no-non-null-assertion': 'off',

      /**
       * As mensagens e rótulos interpolam número de propósito — `${Math.round(p)}%`,
       * `${dias} dias`. É o ponto do texto dizer o número, e `String()` em volta
       * de cada um só adicionaria ruído.
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
       * `void promessa` é intencional nos handlers de clique: `onClick` espera
       * função que devolve `void`, e a mutação do TanStack Query devolve
       * promessa. A regra existe para pegar promessa esquecida; o `void` é a
       * marca de que não foi esquecimento.
       */
      '@typescript-eslint/no-confusing-void-expression': 'off',

      /**
       * `x === false` é o idioma de TRÊS ESTADOS deste projeto, e a regra só
       * enxerga dois.
       *
       * `naMeta()` devolve `boolean | null`, onde `null` é "não há meta para
       * comparar" (§7.37) — e a tela decide cor com
       * `ok === null ? cinza : ok === false ? vermelho : verde`. Depois do
       * primeiro teste o tipo já é `boolean`, então a regra pede `!ok`. Só que
       * `!ok` e `ok === false` deixam de ser a mesma frase para quem lê: a
       * cadeia inteira compara valores explícitos, e trocar o do meio por uma
       * negação esconde que ali existem três respostas possíveis.
       *
       * Aparece em `ReuniaoN3` (duas vezes) e em `PainelPerfis`, onde
       * `ativo === false` diz "desativado" e não "ausente" — mesmo motivo.
       */
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
    },
  },
  {
    /**
     * Os arquivos de configuração da raiz (`vite.config.ts`, `tailwind.config.ts`)
     * ficam fora do alcance do script — `lint` aponta para `src` e `tests`.
     * Este bloco existe para o dia em que alguém ampliar o script: sem ele o
     * parser procura o arquivo no projeto do TypeScript e falha antes de
     * qualquer regra rodar.
     */
    files: ['*.config.{ts,js}', '*.cjs', '*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false, project: null },
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    /**
     * Testes: o `expect` recebe `any` do JSON de resposta, e exigir tipo em cada
     * asserção transformaria teste em exercício de tipagem. Mesmas isenções do
     * backend, pelo mesmo motivo.
     */
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
)
