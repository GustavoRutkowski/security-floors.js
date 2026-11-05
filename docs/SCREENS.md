# Telas do Jogo

## Perfil (Tela Inicial) --> ProfileScreen

Consiste em:

- Menu inicial que pede para que o usuário informe um nickname e escolha um dos personagens disponíveis para jogar
- Botão "jogar", que redireciona para `HomeScreen`

## Lista de Salas --> HomeScreen

Consiste em:

- Uma lista com todas as rooms criadas
- Um botão de "refresh" que busca as salas novamente ao ser clicado"
- Buscar a lista ao abrir a tela e atualizá-la automaticamente a cada 15 segundos enquanto ela estiver visível; parar o polling ao sair da tela

A consulta é feita pelo evento `rooms.list.request` do contrato em `WEBSOCKET.md`. A lista não é transmitida em tempo real; a entrada na sala sempre é revalidada pelo servidor.

Ao clicar em uma sala (representada por um ID), o usuário vai para a tela de `RoomScreen --> {ROOM_ID}` (sala específica que ele escolheu).
No caso de a sala não estar disponível, ou cheia, um popup deve ser exibido.

## Sala Específica --> RoomScreen

Nessa tela, os usuários aguardam até que o owner da partida autorize o início da partida. Os usuários podem sair da sala (redirecionados para `HomeScreen`), ou aguardar o owner autorizar a partida (e ser redirecionado para `GameScreen`).

O owner pode utilizar esta tela para editar informações/regras da sala (nome, max_players, time, etc...)

Alterações de regras e de participantes são transmitidas imediatamente a todos na sala por `room.snapshot`.

## Jogo Rolando --> GameScreen

Aqui é tudo o jogo em si, partida rolando, movimentação, mecânicas definidas e especificadas em outros documentos, etc...
No fim da partida todos os players voltam para `RoomScreen`

Movimentos aceitos e mudanças no ranking são transmitidos imediatamente por `player.moved` e `ranking.updated`, respectivamente. O contrato completo está em `WEBSOCKET.md`.
