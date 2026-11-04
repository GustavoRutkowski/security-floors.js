# Instrucoes para agentes

Este repositorio implementa um jogo web 2D de perguntas sobre seguranca da informacao. Antes de alterar regras do jogo, leia `README.md` e os documentos relevantes em `docs/`.

## Arquitetura

- Use JavaScript ES modules no frontend e no servidor.
- O frontend usa Phaser; a apresentacao e pixelada, em visao superior e com movimentacao em oito direcoes.
- `ws/` e o servidor autoritativo para salas, jogadores conectados, estado da partida e sincronizacao em tempo real.
- `web/` apresenta o jogo e envia intencoes ao servidor; nao deve decidir resultados nem ser fonte de verdade do estado compartilhado.
- `db/` usa SQLite com `better-sqlite3` para persistir salas e questoes. A inicializacao fica em `db/connection.js` e o schema em `db/schema.sql`.
- Nao ha API HTTP no MVP. Adicione Express apenas quando surgir um requisito concreto que o WebSocket nao atenda.
- Usuarios sao efemeros e identificados por UUID gerado no cliente. Nunca crie tabela de usuarios; `rooms.owner_id` nao e chave estrangeira.

## Como trabalhar

- Preserve o escopo do MVP e prefira mudancas pequenas, sem camadas ou abstracoes sem necessidade.
- Valide dados recebidos pelo WebSocket no servidor, inclusive identificadores, configuracoes de sala e respostas.
- Mantenha nomes e valores persistidos compativeis com `RULES.md` e `db/schema.sql`.
- Ao alterar schema, mantenha a inicializacao idempotente e atualize os documentos afetados.
- Mantenha `db/questions.example.json` como fonte autoritativa das questoes do servidor; carregue o catalogo em toda inicializacao sem duplicar registros. Owners nao definem questoes.
- Questões devem conter somente `id`, `prompt`, `options`, `correct_option_index` e `explanation`; nao persistem modo, andar ou caderno.
- O servidor decide aleatoriamente a distribuicao por andar/caderno em tempo de jogo e pode variar a numeracao/ordem exibida por jogador. O modo e propriedade da sala.
- Mantenha o README atualizado com os passos para instalar e executar o setup e, quando existir, o jogo.
- Antes de concluir mudancas, rode `npm run lint` e `npm run format:check` quando aplicaveis. Apos formatar, rode novamente a checagem de formato.
- Use ESLint e Prettier conforme a configuracao existente. Nao introduza TypeScript ou React sem uma decisao explicita de arquitetura.
