# Contrato de mensagens WebSocket

Este documento define o contrato do MVP entre o navegador e o servidor autoritativo em `ws/`. O transporte é WebSocket com mensagens JSON UTF-8, uma mensagem por frame. O servidor valida todas as intenções e é a única fonte de verdade para salas, posições, respostas, progresso e ranking.

## Envelope

Toda mensagem usa este formato:

```json
{
    "type": "rooms.list.request",
    "request_id": "id-unico-da-requisicao",
    "payload": {}
}
```

`type` identifica a mensagem. `payload` sempre é um objeto. Comandos que esperam uma resposta direta incluem `request_id`; a resposta ou erro correspondente repete esse valor. Mensagens assíncronas do servidor, como broadcasts, não precisam de `request_id`. IDs de usuário são UUIDs efêmeros gerados pelo cliente e nunca são persistidos.

O cliente envia intenções, nunca estado calculado: não envia posição absoluta, pontuação, ranking, owner ou resultado correto. Campos desconhecidos, tipos inválidos e comandos fora de estado são rejeitados com `error`.

## Cliente para servidor

| `type`               | `payload`                                                                                                                     | Uso                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.hello`      | `{ "protocol_version": 1, "user_id": "uuid", "nickname": "Ana", "character_id": "character-id" }`                             | Primeiro comando após abrir a conexão. Registra a identidade efêmera para esta conexão.                                                                                                                     |
| `rooms.list.request` | `{}`                                                                                                                          | Busca a lista atual de salas disponíveis. Deve ser enviado ao entrar na Home, pelo botão de atualizar e pelo polling descrito abaixo.                                                                       |
| `room.create`        | `{ "name": "Sala", "mode": "classic", "floors": 10, "notebooks_per_floor": 3, "time_limit_seconds": null, "max_players": 6 }` | Cria uma sala. O owner é o usuário da sessão, não um campo fornecido no payload.                                                                                                                            |
| `room.join`          | `{ "room_id": "uuid-da-sala", "role": "player" }`                                                                             | Entra como `player` ou `spectator`.                                                                                                                                                                         |
| `room.leave`         | `{}`                                                                                                                          | Sai da sala atual.                                                                                                                                                                                          |
| `room.configure`     | `{ "name": "Sala", "mode": "classic", "floors": 10, "notebooks_per_floor": 3, "time_limit_seconds": null, "max_players": 6 }` | Atualiza os campos enviados da configuração. Somente o owner pode alterar configurações e o servidor valida os limites documentados em `RULES.md`.                                                          |
| `match.start`        | `{}`                                                                                                                          | Solicita início da partida. Somente o owner pode iniciar.                                                                                                                                                   |
| `player.move`        | `{ "sequence": 42, "direction": "northeast" }`                                                                                | Envia intenção de movimento. `direction` é `north`, `northeast`, `east`, `southeast`, `south`, `southwest`, `west`, `northwest` ou `stop`. A sequência cresce por jogador; o cliente não envia coordenadas. |
| `question.answer`    | `{ "question_id": 17, "option_index": 1 }`                                                                                    | Envia a alternativa escolhida para a pergunta apresentada ao jogador. O índice começa em zero. Requer `request_id`.                                                                                         |

`room.configure` pode conter somente os campos a alterar; campos omitidos permanecem inalterados. `time_limit_seconds: null` significa tempo ilimitado. O servidor ignora ou rejeita comandos de jogo enviados por espectadores; eles não movimentam personagens nem respondem questões.

## Servidor para cliente

| `type`               | `payload`                                                                                                                                                                                                                                                                                                                          | Destinatários e momento                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session.ready`      | `{ "protocol_version": 1, "user_id": "uuid" }`                                                                                                                                                                                                                                                                                     | Resposta a `session.hello`; a sessão pode então enviar os demais comandos.                                                                                                                                               |
| `rooms.list`         | `{ "rooms": [{ "room_id": "uuid", "name": "Sala", "mode": "classic", "floors": 10, "notebooks_per_floor": 3, "time_limit_seconds": null, "max_players": 6, "player_count": 2, "status": "waiting" }] }`                                                                                                                            | Resposta a cada `rooms.list.request`, somente para quem pediu. Não há broadcast da lista.                                                                                                                                |
| `room.snapshot`      | `{ "revision": 4, "room": { "room_id": "uuid", "name": "Sala", "owner_id": "uuid", "mode": "classic", "floors": 10, "notebooks_per_floor": 3, "time_limit_seconds": null, "max_players": 6, "status": "waiting" }, "participants": [{ "user_id": "uuid", "nickname": "Ana", "character_id": "character-id", "role": "player" }] }` | Snapshot completo enviado ao entrar e imediatamente a todos na sala após qualquer mudança de configuração, owner, status ou participantes, incluindo espectadores. `revision` cresce a cada alteração de estado da sala. |
| `room.left`          | `{ "room_id": "uuid" }`                                                                                                                                                                                                                                                                                                            | Confirma a saída ao usuário que saiu. Os demais recebem o `room.snapshot` atualizado imediatamente.                                                                                                                      |
| `match.started`      | `{ "room_id": "uuid" }`                                                                                                                                                                                                                                                                                                            | Confirma início aos participantes; seguido pelo estado inicial da partida.                                                                                                                                               |
| `match.snapshot`     | `{ "revision": 1, "players": [{ "user_id": "uuid", "x": 0, "y": 0, "floor": 1, "status": "playing" }] }`                                                                                                                                                                                                                           | Estado inicial e ressincronização de partida para jogadores e espectadores. Não inclui respostas corretas.                                                                                                               |
| `question.presented` | `{ "question_id": 17, "floor": 1, "notebook_id": "id-do-caderno", "notebook_label": 2, "prompt": "Enunciado", "options": ["Opção A", "Opção B"] }`                                                                                                                                                                                 | Pergunta disponível para o jogador correspondente. Não inclui `correct_option_index` nem `explanation`.                                                                                                                  |
| `player.moved`       | `{ "revision": 18, "user_id": "uuid", "sequence": 42, "direction": "northeast", "x": 12, "y": 8 }`                                                                                                                                                                                                                                 | Broadcast imediato a todos os participantes da partida para cada movimento aceito. Coordenadas e sequência são confirmadas pelo servidor.                                                                                |
| `answer.result`      | `{ "question_id": 17, "correct": false, "correct_option_index": 0, "explanation": "Confira a origem do link.", "floor": 1 }`                                                                                                                                                                                                       | Resposta direta após o servidor avaliar `question.answer`. Somente aqui, depois da avaliação, o índice correto pode ser enviado.                                                                                         |
| `ranking.updated`    | `{ "revision": 19, "entries": [{ "rank": 1, "user_id": "uuid", "nickname": "Ana", "floor": 4, "status": "playing" }] }`                                                                                                                                                                                                            | Broadcast imediato a jogadores e espectadores sempre que a classificação mudar. Ordem e desempates são calculados pelo servidor.                                                                                         |
| `match.ended`        | `{ "reason": "all_players_finished", "entries": [{ "rank": 1, "user_id": "uuid", "nickname": "Ana", "floor": 10, "status": "finished" }] }`                                                                                                                                                                                        | Resultado final para todos; `reason` identifica a condição de encerramento. Depois, o servidor envia o snapshot da sala ao retornar os participantes ao lobby.                                                           |
| `error`              | `{ "code": "ROOM_FULL", "message": "A sala está cheia.", "retryable": false }`                                                                                                                                                                                                                                                     | Erro de comando. Inclui `request_id` quando responde a uma requisição correlacionada.                                                                                                                                    |

O servidor envia `room.snapshot` ao criador/participante depois de criar ou entrar na sala; uma alteração de configuração ou presença não é considerada concluída no cliente até receber o novo snapshot. A sequência WebSocket preserva a ordem das mensagens. `revision` permite detectar estado antigo após reconexão ou processamento assíncrono.

## Sincronização e salas

Configuração, owner e quantidade/identidade de participantes são estado da sala e geram `room.snapshot` imediatamente para todos os membros conectados. Movimento aceito gera `player.moved` imediatamente; mudança na classificação gera `ranking.updated` imediatamente. Esses broadcasts incluem espectadores quando são observadores da sala/partida.

A lista de salas é uma consulta, não um fluxo em tempo real: solicitar ao abrir a Home, ao acionar atualizar e a cada 15 segundos enquanto a Home estiver visível. Interromper o polling ao sair da tela e fazer uma nova consulta ao reconectar. A lista inclui apenas os dados resumidos necessários para descoberta; entrar na sala sempre exige nova validação do servidor. O MVP usa WS para essa consulta e não cria uma API HTTP.

## Erros

`error.payload.code` usa um código estável para lógica do cliente; `message` é texto para apresentação e não deve ser interpretado. `retryable` indica se faz sentido repetir a mesma ação sem alterar seus dados.

| Código                  | Significado                                           |
| ----------------------- | ----------------------------------------------------- |
| `INVALID_MESSAGE`       | JSON, envelope, tipo ou payload inválido.             |
| `SESSION_REQUIRED`      | A sessão ainda não enviou `session.hello`.            |
| `ROOM_NOT_FOUND`        | Sala inexistente ou já removida.                      |
| `ROOM_FULL`             | Limite de jogadores atingido.                         |
| `ROOM_IN_PROGRESS`      | A ação exige uma sala aguardando.                     |
| `INVALID_ROOM_SETTINGS` | Configuração fora dos limites permitidos.             |
| `NOT_ROOM_OWNER`        | Ação de owner enviada por outro participante.         |
| `NOT_IN_ROOM`           | Ação requer participação na sala.                     |
| `FORBIDDEN_ROLE`        | Ação de jogo enviada por espectador.                  |
| `INVALID_ANSWER`        | Pergunta, alternativa ou estado da resposta inválido. |
| `STALE_INPUT`           | Sequência de movimento antiga ou repetida.            |
| `ACTION_NOT_ALLOWED`    | Ação incompatível com o estado atual da sala/partida. |
| `INTERNAL_ERROR`        | Falha inesperada; não expõe detalhes internos.        |

## Transições de tela

| Tela atual    | Evento/ação                                                    | Próxima tela                                                      |
| ------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Perfil        | Conexão aberta e `session.ready`                               | Home; solicita `rooms.list.request`.                              |
| Home          | `room.create` ou `room.join` aceito e `room.snapshot` recebido | Sala. Um erro mantém na Home e é apresentado ao usuário.          |
| Sala          | `room.snapshot`                                                | Atualiza configuração e participantes sem trocar de tela.         |
| Sala          | `match.started` e `match.snapshot`                             | Jogo.                                                             |
| Jogo          | `question.presented`, `player.moved` ou `ranking.updated`      | Atualiza a partida atual sem trocar de tela.                      |
| Jogo          | `match.ended`                                                  | Resultado.                                                        |
| Resultado     | Snapshot da sala após conclusão/retorno                        | Sala, pronta para outra partida.                                  |
| Qualquer tela | `error`                                                        | Permanece na tela; mostra o erro sem aplicar a mutação rejeitada. |

As decisões específicas de desconexão, reconexão, espectadores e desempate são detalhadas em `TODO.md` na MVP-04. Este contrato não promete restaurar uma sessão depois da queda do socket.
