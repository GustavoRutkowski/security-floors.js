# TODO: MVP

Este plano cobre o trabalho restante para entregar o MVP jogável descrito em `README.md`, `RULES.md` e `docs/`. Execute as tarefas na ordem indicada para respeitar suas dependências.

Cada caixa abaixo representa **um único commit**. Não agrupe duas tarefas em um commit. O critério de conclusão de cada tarefa inclui os testes pertinentes; atualize a documentação afetada junto da implementação quando necessário.

## Base e contratos

- [x] **MVP-01** `fix: use the example question catalog consistently` — Manter `db/questions.example.json` como modelo e `db/questions.json` como catálogo efetivo, sincronizando-o por UPSERT e importando somente os cinco campos da questão.
- [x] **MVP-02** `test: add database bootstrap tests` — Adicionar testes com `node:test` para schema, formato exato das questões, validação de alternativas/índice correto e carga idempotente do catálogo; expor `npm test`.
- [ ] **MVP-03** `docs: define the websocket message contract` — Documentar eventos cliente-servidor e servidor-cliente, payloads, erros e transições de tela; especificar que o servidor nunca envia `correct_option_index` antes de avaliar a resposta.
- [ ] **MVP-04** `docs: settle MVP edge-case rules` — Registrar decisões para limite de espectadores, desconexão/reconexão, owner desconectado durante partida, empate no ranking, limite de tempo, catálogo insuficiente para preencher a partida e ordem de cadernos individual por jogador.
- [ ] **MVP-05** `build: add Phaser Vite and websocket tooling` — Adicionar Phaser, Vite e biblioteca WebSocket do servidor, scripts de desenvolvimento/build/teste e execução conjunta de web e WS; manter a arquitetura sem Express.
- [ ] **MVP-06** `feat: bootstrap the browser game` — Criar a página de entrada e inicializar o cliente JavaScript/Phaser com redimensionamento, tela de carregamento e tratamento visível de erro.
- [ ] **MVP-07** `feat: bootstrap the websocket server` — Implementar início e encerramento limpos do servidor WS, configuração de porta e tratamento de conexão; não adicionar API HTTP.

## Salas e presença

- [ ] **MVP-08** `feat: add room persistence operations` — Implementar operações SQLite parametrizadas para criar, listar, atualizar e remover salas, validando limites de andares, cadernos, modo, tempo e jogadores.
- [ ] **MVP-09** `feat: add authoritative room presence state` — Implementar estado em memória para conexões, jogadores, espectadores e ordem de entrada, sem persistir usuários ou presença.
- [ ] **MVP-10** `feat: handle room creation and listing` — Implementar eventos WS para criar salas e listar/atualizar a lista, validando dados no servidor e retornando erros previsíveis.
- [ ] **MVP-11** `feat: handle room joining and leaving` — Implementar entrada e saída de salas, rejeitar salas inexistentes/cheias/em partida quando aplicável e transmitir a lista atual de participantes.
- [ ] **MVP-12** `feat: implement owner room controls` — Permitir ao owner editar configurações permitidas e iniciar a partida; rejeitar as mesmas ações quando enviadas por outro jogador.
- [ ] **MVP-13** `feat: implement owner handoff and empty-room cleanup` — Ao sair ou desconectar o owner, transferir a propriedade ao jogador elegível mais antigo; apagar do SQLite a sala que ficar sem jogadores.
- [ ] **MVP-14** `feat: implement spectator participation` — Permitir assistir sem controlar personagem, responder questões ou afetar ranking; aplicar a política de capacidade definida em `MVP-04`.

## Estado e regras da partida

- [ ] **MVP-15** `feat: distribute questions randomly per match` — Criar a distribuição autoritativa de questões por andar/caderno a cada partida, sem gravar posicionamento no catálogo; embaralhar rótulos/ordem de cadernos por jogador e testar a distribuição com aleatoriedade injetável.
- [ ] **MVP-16** `feat: synchronize authoritative player movement` — Implementar movimento em oito direções no servidor, limites do mapa e broadcast do estado validado aos participantes; ignorar comandos de espectadores.
- [ ] **MVP-17** `feat: implement classic mode progression` — Avaliar respostas no servidor, avançar com acerto em qualquer caderno e aplicar espera de `S` segundos após errar todos os cadernos do andar.
- [ ] **MVP-18** `feat: implement deathmatch elimination` — Usar um caderno por andar, eliminar imediatamente quem errar e encerrar quando as questões terminarem ou restar um jogador.
- [ ] **MVP-19** `feat: implement match timers and termination` — Aplicar tempo limite configurado ou partida sem limite; no modo clássico, encerrar quando todos chegarem ao topo ou quando o tempo terminar; cobrir corridas entre timeout e última resposta.
- [ ] **MVP-20** `feat: calculate and broadcast live rankings` — Priorizar quem alcança primeiro o andar final no clássico, definir desempate determinístico, transmitir atualizações e não permitir que o cliente envie pontuação.
- [ ] **MVP-21** `feat: return completed matches to the room` — Encerrar a sessão de jogo, retornar todos à sala, limpar estado transitório e permitir que o owner autorize uma nova partida.

## Cliente e telas

- [ ] **MVP-22** `feat: add the player profile screen` — Criar escolha de nickname/personagem, gerar UUID no navegador e persistir esses dados localmente, nunca no banco.
- [ ] **MVP-23** `feat: add the websocket client` — Implementar conexão, envio de intenções, validação básica dos eventos recebidos, estados de conexão e apresentação de erros/reconexão conforme `MVP-04`.
- [ ] **MVP-24** `feat: add the room browser screen` — Exibir salas disponíveis, permitir atualizar a lista e entrar em uma sala; mostrar feedback para sala cheia ou indisponível.
- [ ] **MVP-25** `feat: add the room lobby screen` — Exibir participantes e estado da sala, controles de owner, configuração da sala, saída e início da partida; suportar o fluxo de espectador.
- [ ] **MVP-26** `feat: render the top-down game scene` — Criar o mapa e personagens provisórios pixelados, câmera e controles de movimento em oito direções, refletindo o estado recebido do servidor.
- [ ] **MVP-27** `feat: add the question and notebook interface` — Exibir enunciado e alternativas, enviar apenas a escolha do jogador, mostrar feedback após avaliação e renderizar a ordem/número de caderno atribuído àquele jogador.
- [ ] **MVP-28** `feat: add spectator and live ranking views` — Mostrar a partida e o ranking em tempo real para espectadores e jogadores sem conceder controles de jogo a espectadores.
- [ ] **MVP-29** `feat: add game results and rematch flow` — Exibir resultado final, classificação e transição de volta ao lobby, incluindo o fluxo para o owner iniciar outra partida.
- [ ] **MVP-30** `style: complete responsive pixel-art presentation` — Aplicar o estilo retro/pixelado definido em `docs/STYLE.md`, estados de carregamento/vazio/erro e layout utilizável em telas pequenas e grandes.

## Integração e entrega

- [ ] **MVP-31** `test: cover multiplayer room and match lifecycle` — Adicionar teste de integração com múltiplos clientes WS cobrindo criar/descobrir/entrar/sair, owner handoff, espectador, início, sincronização, respostas, ranking e retorno ao lobby.
- [ ] **MVP-32** `docs: document running and operating the MVP` — Atualizar README com instalação, configuração, comandos de desenvolvimento/build, portas, fluxo de duas ou mais sessões e solução dos erros comuns.
- [ ] **MVP-33** `test: verify production build and MVP acceptance flow` — Rodar lint, formato, testes e build; executar o roteiro de aceitação com pelo menos dois jogadores e um espectador, cobrindo clássico, mata-mata, encerramento por tempo e encerramento por condição de vitória.

## Critério de MVP concluído

O MVP estará pronto quando um usuário puder criar um perfil local, encontrar ou criar uma sala, configurar e aguardar no lobby, iniciar uma partida sincronizada por WS, movimentar-se, responder questões, jogar clássico ou mata-mata, assistir como espectador, acompanhar ranking ao vivo e retornar ao lobby após o resultado. O servidor deve permanecer como autoridade das regras e do estado compartilhado; usuários e estado transitório não devem ser persistidos; os comandos documentados de lint, formato, teste e build devem passar.
