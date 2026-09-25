import { buildApp } from './app.js'
import { env } from './config/env.js'

const app = await buildApp()

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  // `void` na frente: `process.on` espera retorno void e o handler e' async.
  // Sem isto a promessa fica solta — e se `app.close()` rejeitar, o Node derruba
  // o processo por rejeicao nao tratada, no meio do encerramento gracioso.
  process.on(sinal, () => {
    void (async () => {
      app.log.info(`${sinal} recebido, encerrando`)
      await app.close()
      process.exit(0)
    })()
  })
}

try {
  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(`Portal GD · docs em http://localhost:${env.PORT}/docs`)
} catch (erro) {
  app.log.error(erro)
  process.exit(1)
}
