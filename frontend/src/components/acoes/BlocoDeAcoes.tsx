import { Link } from 'react-router-dom'
import { ROTULO_STATUS, type ResumoAcao } from '../../lib/api.js'
import { COR_STATUS_QUADRO } from '../../lib/cor-status-quadro.js'
import { acoes } from '../../lib/nomes.js'
/*
 * O CSS vem do arquivo da reunião do N4, onde estas regras moram desde o §7.61.
 *
 * O import fica AQUI, e não só na tela: quando o N3 monta este bloco,
 * `reuniao-n4.css` pode não ter sido carregado, e ele apareceria sem estilo
 * nenhum — sem erro, só feio. CSS é global e idempotente; importar duas vezes
 * não custa nada.
 *
 * **Dívida anotada:** as classes começam com `n4-` e o bloco agora serve as duas
 * reuniões. Renomeá-las é mexer em CSS de uma tela em uso; fica para quando
 * houver um terceiro caso.
 */
import '../../routes/reuniao-n4.css'

/**
 * "O QUE JÁ ESTÁ SENDO FEITO" — o terceiro tempo da reunião do GD.
 *
 * A ordem é "o que aconteceu → por quê → o que está sendo feito", e este é o
 * terceiro. Nasceu no N3, foi para o N4 quando o cartão de gerência virou link
 * (§7.61), e virou componente em 11/09/2026 — quando voltou a servir os dois.
 *
 * **É AQUI QUE A VISÃO GERENCIAL MORA AGORA.** A aba "nível abaixo" da tela de
 * Ações saiu no mesmo dia, a pedido do analista: *"ele vai ver ao abrir o GD da
 * mesma forma que o N3 vê as ações do GD da N4"*. A diferença não é de
 * conteúdo, é de CONTEXTO: na lista de Ações a ação do vizinho aparecia
 * misturada às suas; aqui ela aparece dentro da reunião à qual pertence.
 *
 * Recebe a lista PRONTA. Quem busca é a tela, porque o recorte de cada uma é
 * diferente — a gerência no N4, o quadro da loja no N3 — e isso não é assunto
 * deste componente.
 */
export function BlocoDeAcoes({
  acoesAbertas: lista,
  vazio,
}: {
  acoesAbertas: ResumoAcao[]
  /** A frase de lista vazia: ela nomeia o recorte, que só a tela conhece. */
  vazio: string
}) {
  return (
    <section className="n4-cartao">
      <div className="n4-titulo-bloco">
        <h3>O que já está sendo feito</h3>
        <p>
          {lista.length === 0
            ? vazio
            : `${acoes(lista.length)} · a trilha mostra onde a cadeia de ajuda está`}
        </p>
      </div>

      {lista.map((a) => {
        const ultimo = a.trilha.length - 1;
        return (
          /*
            LINK para a ação, e não uma linha morta.
            Quem lê "atrasada há 14 dias" na reunião quer abrir aquela ação, e
            o código no chip não é copiável de um quadro projetado na parede.

            `n4-acao` traz `text-decoration: none` -- foi o defeito que o cartão
            de gerência do N3 teve ao virar link (§7.59): sem isso o navegador
            sublinha o título, os chips e a trilha inteira, compila, passa no
            lint e só aparece na tela.
          */
          <Link
            key={a.codigo}
            to={`/contramedida/${a.codigo}`}
            className="n4-acao"
          >
            <span className="n4-acao-corpo">
              <span className="n4-acao-t">{a.titulo}</span>
              <span className="n4-acao-meta">
                <span className="n4-chip" style={COR_STATUS_QUADRO[a.status]}>
                  {/*
                    Sem `?? a.status`: o mapa e' `Record<StatusAcao, string>`, e
                    o compilador garante que todo status tem rotulo. O fallback
                    existia porque o mapa era `Record<string, ...>` -- e foi por
                    isso que `REJEITADA` apareceu sem rotulo quando nasceu, sem
                    ninguem ser avisado.
                  */}
                  {ROTULO_STATUS[a.status]}
                </span>
                <span className="n4-acao-cod">{a.codigo}</span>
                <span className="n4-acao-quem">
                  {a.agrupamento.nome} · {a.responsavel} · {a.diasEmAberto} dias
                </span>
              </span>

              {/*
                Trilha de um passo só significa que a ação nunca foi escalada —
                e aí não há cadeia para mostrar. Desenhá-la com um degrau
                sugeriria movimento que não houve.
              */}
              {a.trilha.length > 1 && (
                <span className="n4-trilha">
                  {a.trilha.map((p, i) => (
                    <span
                      key={`${p.nivel}-${String(i)}`}
                      style={{ display: "contents" }}
                    >
                      {i > 0 && <span className="n4-trilha-seta">→</span>}
                      <span
                        className={`n4-passo ${i === ultimo ? "aqui" : ""}`}
                      >
                        <b>{p.nivel}</b>
                        <span>{p.quem}</span>
                        {/*
                          Dez dias no nível ATUAL vira vermelho: é o sinal de
                          que a cadeia de ajuda parou de andar, que é justamente
                          o que a reunião procura. Nos níveis por onde já passou
                          o número é histórico, e pintá-lo acusaria quem já
                          repassou.
                        */}
                        <i
                          style={
                            i === ultimo && p.dias >= 10
                              ? { color: "var(--cri-texto)", fontWeight: 700 }
                              : undefined
                          }
                        >
                          {p.dias}d
                        </i>
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="n4-acao-ir" aria-hidden>
              →
            </span>
          </Link>
        );
      })}
    </section>
  );
}
