# Contexto de IA do repositorio

Estas instrucoes complementam `AGENTS.md`. Leia `README.md`, `RULES.md` e os documentos de `docs/` pertinentes antes de propor mudancas funcionais.

## Prioridades

1. Preserve os requisitos documentados do MVP.
2. Mantenha o servidor WebSocket como autoridade do estado compartilhado.
3. Prefira a menor solucao funcional em JavaScript puro, Phaser e SQLite.
4. Nao introduza API HTTP, framework, camada ou dependencia sem necessidade concreta.
5. Nao persista usuarios ou dados efemeros de partida.

## Decisoes atuais

- Runtime: Node.js 20.19 ou superior; modulos ES.
- Persistencia: SQLite via `better-sqlite3`, com schema inicial em `db/schema.sql`.
- Conexao: `db/connection.js`; `DB_PATH` pode ser fornecido pelo ambiente. Copie `.env.example` para `.env` e inicie Node com `--env-file=.env` se quiser carregar esse arquivo.
- Salas usam os modos `classic` e `deathmatch`; tempo ilimitado e armazenado como `NULL`.
- Questões sao de multipla escolha, alternativas em JSON e indice correto baseado em zero.
- `db/questions.example.json` e um modelo versionado; `db/questions.json`, ignorado pelo Git, e o catalogo efetivo. `db/connection.js` sincroniza esse catalogo no banco por UPSERT de ID dentro de uma transacao e remove registros ausentes; questoes nao sao configuradas por owner. Cada questao contem apenas `id`, `prompt`, `options`, `correct_option_index` e `explanation`. O servidor sorteia andar/caderno em tempo de jogo; a numeracao e a ordem exibidas podem variar por jogador. O modo pertence a sala.
- IDs de usuario sao UUIDs efemeros do cliente; `owner_id` e dado sem chave estrangeira.

## Forma de colaborar

- Se uma especificacao estiver em aberto e mudar o schema, o protocolo WS ou uma regra central, pergunte antes de fixar a decisao. Para detalhes locais reversiveis, escolha a opcao mais simples e documente-a.
- Valide entradas no limite do servidor, use statements parametrizados e evite expor respostas corretas antes da tentativa.
- Mantenha no README os passos de instalacao e execucao disponiveis no estado atual do projeto.
- Antes de concluir mudancas, rode `npm run lint` e `npm run format:check` quando aplicaveis. Depois de formatar, rode novamente `npm run format:check`.
- Edite apenas os arquivos necessarios e rode a verificacao mais focada disponivel.
