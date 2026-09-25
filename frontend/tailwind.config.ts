import type { Config } from 'tailwindcss'

/**
 * Tokens do design handoff (docs/handoff/README.md).
 *
 * Regra: nenhum hex solto no JSX. Se uma cor não está aqui, ela não existe no
 * produto. Nomes são semânticos (`ok`, `risco`, `critico`) e não descritivos
 * (`verde`, `amarelo`) — o dia em que "em risco" deixar de ser amarelo, muda
 * num lugar só.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Superfícies internas do produto
        navy: { DEFAULT: '#001F3F', hover: '#123A64', medio: '#12406F' },
        fundo: '#EEF0F4',
        superficie: {
          DEFAULT: '#FFFFFF',
          alt: '#FBFCFE', // linha alternada de tabela
          header: '#F7F9FC', // cabeçalho de tabela clara
          hover: '#F2F6FC', // célula clicável em hover
        },
        borda: {
          DEFAULT: '#DFE4EC',
          sutil: '#EDF0F5',
          divisor: '#E7EBF2',
          clara: '#F2F5F9',
          hover: '#C7D6EA',
        },
        texto: {
          DEFAULT: '#0F1B2D',
          sec: '#5B6B85',
          ter: '#8592A8', // labels, eyebrow
          off: '#A9B4C6', // desabilitado
        },
        sobreNavy: { sec: '#8FA6C4', icone: '#C7D6EA' },

        // Semântica de status do GD
        ok: { bg: '#E8F6EE', borda: '#A9DFC1', texto: '#1B7A44', ponto: '#27AE60' },
        // Quarta faixa, só de Perdas: bem acima da meta. O nome é semântico
        // (`otimo`) e não `azul` pela mesma regra dos outros — se um dia deixar
        // de ser azul, muda num lugar só. Os tons acompanham a paleta do portal
        // em vez de copiar o #3581d8 do dashboard: aqui o sistema visual é o do
        // handoff, e um azul de fora brigaria com o navy da marca.
        otimo: { bg: '#EAF1FB', borda: '#AFC9EC', texto: '#1B4F8F', ponto: '#3581D8' },
        risco: { bg: '#FDF2DE', borda: '#F3D08A', texto: '#8A5A05', ponto: '#F39C12' },
        critico: { bg: '#FCECEA', borda: '#F3B3AB', texto: '#A32116', ponto: '#E74C3C' },
        escala: { bg: '#FFF1EB', borda: '#FFCDB6', texto: '#C4501B', ponto: '#FF6B35' },
        andamento: { bg: '#EFF3F8', borda: '#D2DEEC', texto: '#12406F' },

        // Botões de ação
        acao: {
          concluir: '#27AE60',
          concluirHover: '#219150',
          escalar: '#FF6B35',
          escalarHover: '#E85B27',
          revisar: '#F39C12',
          direcionar: '#12406F',
        },

        // Marca Acme Varejo (tela de login)
        brand: {
          vermelho: '#E71C35',
          btn: '#CF1030',
          btnHover: '#B80D29',
          fundo: '#F7F7F8',
          borda: '#E3E3E5',
          texto: '#636363',
          campo: '#EEF3FB',
          erroBg: '#FDF1F2',
          erroTexto: '#B80D29',
        },

        // Grade do gráfico
        grade: { DEFAULT: '#EEF1F6', base: '#E3E3E7', trilha: '#F1F3F7' },
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },

      fontSize: {
        // [tamanho, { lineHeight, letterSpacing, fontWeight }]
        micro: ['11px', { lineHeight: '1.4' }],
        legenda: ['12px', { lineHeight: '1.4' }],
        corpo: ['13px', { lineHeight: '1.5' }],
        'corpo-forte': ['14px', { lineHeight: '1.5', fontWeight: '700' }],
        'titulo-card': ['15px', { lineHeight: '1.3', fontWeight: '700' }],
        'titulo-secao': ['17px', { lineHeight: '1.3', letterSpacing: '-0.2px', fontWeight: '700' }],
        'titulo-tela': ['22px', { lineHeight: '1.2', letterSpacing: '-0.4px', fontWeight: '800' }],
        'titulo-detalhe': ['26px', { lineHeight: '1.2', letterSpacing: '-0.6px', fontWeight: '800' }],
        kpi: ['26px', { lineHeight: '1.1', fontWeight: '800' }],
        /*
         * 16px, e não 20. Vendas passou a mostrar `R$ 13,76 mi` na célula,
         * como no N3 e no N4, e em 20px o texto pede 111px -- as nove colunas
         * não tinham isso e ele quebrava em três linhas, com o "mi" sozinho
         * embaixo. Em 16px pede 89, e a matriz inteira cabe em 1135px.
         *
         * Continua sendo o maior texto da célula: o desvio embaixo tem 10px.
         */
        celula: ['16px', { lineHeight: '1.1', fontWeight: '700' }],
        eyebrow: ['10px', { lineHeight: '1.2', letterSpacing: '0.14em', fontWeight: '700' }],
        coluna: ['10px', { lineHeight: '1.2', letterSpacing: '0.12em', fontWeight: '700' }],
        badge: ['10px', { lineHeight: '1.2', letterSpacing: '0.06em', fontWeight: '700' }],
      },

      borderRadius: {
        card: '12px',
        controle: '8px',
        campo: '10px',
        celula: '10px',
        botaoPequeno: '7px',
        modal: '14px',
      },

      boxShadow: {
        card: '0 2px 6px rgba(15,15,15,.05)',
        modal: '0 24px 60px rgba(0,31,63,.35)',
        /** Faz o navy "descer" na barra branca do header sem degradê. */
        headerInset: 'inset 0 6px 8px -8px rgba(0,31,63,.45)',
      },

      backgroundColor: {
        overlay: 'rgba(0,31,63,.55)',
      },

      transitionDuration: {
        hover: '120ms',
      },

      spacing: {
        gutter: '32px',
      },
    },
  },
  plugins: [],
} satisfies Config
