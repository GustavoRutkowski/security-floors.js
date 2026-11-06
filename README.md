# security-floors.js

Jogo de navegador voltado para o ensino gameficado de princípios de segurança da informação.

## MVP Inicial

- Sistema de rooms
- Sistema de andares
- Movimentação
- Modo Espectador
- Modos de Jogo: Clássico | Mata-Mata
- Ranking ao vivo

## Regras Gerais (Modo Clássico):

- Você está num prédio de X andares
- Cada andar possui K cadernos de tarefas
- Se você acertar a resposta, passa para o próximo andar
- Você passa para o próximo andar ao acertar qualquer uma das K questões, apresentadas em uma ordem individual de cadernos
- Se errar todos os cadernos do andar, aguarda 5 segundos; quando a porta abre, avança automaticamente para o próximo andar
- O ranking/placar é dado em ordem crescente do jogador que chegar primeiro no andar final
- Quando todos os jogadores chegam até o topo (ou o tempo T se encerra), a partida acaba e uma tela com ranking é exibida

## Telas

## Modos de Jogo

- Clássico (regras já descritas)
- Mata-Mata --> Existe apenas um caderno por andar. Quem errar é eliminado instantaneamente; vence quem responder corretamente todas as questões ou permanecer como último jogador ativo. Se todos os concorrentes restantes expirarem a tolerância de reconexão, o último a expirar vence por ausência de adversários.

## Estrutura de Pastas:

- /ws → Lida com websockets e sincronização (é a camada central responsáel por sincronizar tudo para todos)
- /web → Lida com a exibição do game em si (frontend)
- /web/spritesheets → Folhas de sprites
- /db → Banco de Dados

## Stack:

- JS → Linguagem Principal (tanto do back quanto do frontend)
- Phaser → Renderização visual
- SQLite → Lida com o Armazenamento das Questões e das Salas (USUÁRIOS SÃO UUIDs gerados pelo cliente que transitam via WS, mas NÃO DEVEM ser armazenados no banco)
- ESLint / Prettier / Husky → Qualidade de código

## Setup e comandos

Requisitos: Node.js 20.19 ou superior e npm.

```sh
npm install
cp .env.example .env
cp db/questions.example.json db/questions.json
npm run db:init
```

`db/questions.example.json` é um modelo versionado. Copie-o para `db/questions.json` e mantenha nesse arquivo o catálogo real, que é ignorado pelo Git e carregado por `db:init` no banco SQLite definido por `DB_PATH`. Em cada inicialização, as questões são inseridas ou atualizadas por `id`, e registros ausentes do catálogo são removidos; owners não definem questões. Cada questão importa somente `id`, `prompt`, `options`, `correct_option_index` e `explanation`. O servidor sorteia em tempo de jogo o andar e o caderno em que cada questão aparece; a numeração e a ordem exibidas podem ser embaralhadas por jogador. O modo pertence à sala, e não à questão.

`npm run dev:web` abre a tela de perfil, com escolha de nickname e personagem. O navegador salva `user_id`, `nickname` e `character_id` em `localStorage`; o UUID é criado na primeira gravação e preservado ao editar o perfil. Esses dados não são enviados ao banco. O botão de jogar abre a Home local; a conexão WS e a lista de salas serão integradas nas próximas etapas do cliente. As spritesheets disponíveis estão em `web/spritesheets/` e documentadas em [`docs/SPRITESHEETS.md`](docs/SPRITESHEETS.md).

O contrato planejado para mensagens WebSocket, sincronização de salas/partidas, consulta periódica da lista de salas, erros e transições de tela está em [`docs/WEBSOCKET.md`](docs/WEBSOCKET.md).

## Desenvolvimento web e WebSocket

O tooling usa Phaser, Vite e `ws`. `npm run dev` executa Vite e o processo WS em paralelo; `npm run dev:web` e `npm run dev:ws` iniciam cada processo separadamente. A interface Vite usa a pasta `web/`; host e porta de desenvolvimento são definidos por `VITE_HOST` e `VITE_PORT` (padrões `0.0.0.0` e `5173`). Preview usa `VITE_PREVIEW_HOST` e `VITE_PREVIEW_PORT` (padrões `0.0.0.0` e `4173`). O cliente lê `VITE_WS_URL`; o servidor WS escuta em `WS_HOST` e `WS_PORT` (padrões `0.0.0.0` e `3001`). `npm run build` gera a versão de produção em `dist/`, e `npm run preview` serve esse build localmente.

O servidor WS inicia sem API HTTP e encerra de forma graciosa em `SIGINT`/`SIGTERM`. Estão disponíveis `session.hello`, `room.create`, `rooms.list.request`, `room.join` e `room.leave`; controles de owner e ações de partida serão adicionados nas próximas etapas. O setup local deve incluir `db/questions.json` antes de iniciar `npm run dev:ws` ou `npm run dev`.

Antes de concluir alterações, rode as verificações pertinentes:

```sh
npm test
npm run lint
npm run format:check
npm run build
```

Depois de editar arquivos suportados pelo Prettier, aplique a formatação com `npm run format` e rode novamente `npm run format:check`.
