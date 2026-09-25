/**
 * Erros de domínio. O handler global (plugins/erros.ts) traduz para HTTP.
 * Stack trace vai só para o log estruturado, nunca para a resposta.
 */
export class ErroApp extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    message: string,
    readonly detalhes?: unknown,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class NaoAutenticado extends ErroApp {
  constructor(msg = 'Sessão inválida ou expirada.') {
    super(401, 'NAO_AUTENTICADO', msg)
  }
}

export class NaoAutorizado extends ErroApp {
  constructor(msg = 'Você não tem permissão para esta ação.') {
    super(403, 'NAO_AUTORIZADO', msg)
  }
}

export class NaoEncontrado extends ErroApp {
  constructor(recurso: string) {
    super(404, 'NAO_ENCONTRADO', `${recurso} não encontrado.`)
  }
}

export class DadosInvalidos extends ErroApp {
  constructor(msg: string, detalhes?: unknown) {
    super(422, 'DADOS_INVALIDOS', msg, detalhes)
  }
}

export class Conflito extends ErroApp {
  constructor(msg: string) {
    super(409, 'CONFLITO', msg)
  }
}
