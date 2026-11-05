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
- Você só pode passar para o próximo andar se acertar alguma das K questões (algum dos cadernos)
- Se você errar as questões de todos os cadernos, estará sujeito a um tempo de espera de S segundos para que a porta se abra para você
- O ranking/placar é dado em ordem crescente do jogador que chegar primeiro no andar final
- Quando todos os jogadores chegam até o topo (ou o tempo T se encerra), a partida acaba e uma tela com ranking é exibida

## Telas

## Modos de Jogo

- Clássico (regras já descritas)
- Mata-Mata --> Existe apenas um caderno por andar, quem acertar segue jogando, quem errar é eliminado instantaneamente. Vence aquele que se manter vivo até que o número de questões chegue ao fim ou que não sobrem mais adversários.

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

O servidor WebSocket e a interface do jogo ainda não foram implementados, então não há um comando para iniciar uma partida neste setup inicial.

O contrato planejado para mensagens WebSocket, sincronização de salas/partidas, consulta periódica da lista de salas, erros e transições de tela está em [`docs/WEBSOCKET.md`](docs/WEBSOCKET.md).

Antes de concluir alterações, rode as verificações pertinentes:

```sh
npm test
npm run lint
npm run format:check
```

Depois de editar arquivos suportados pelo Prettier, aplique a formatação com `npm run format` e rode novamente `npm run format:check`.
