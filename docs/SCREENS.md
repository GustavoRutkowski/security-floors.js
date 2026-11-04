# Telas do Jogo

## Perfil (Tela Inicial) --> ProfileScreen

Consiste em:

- Menu inicial que pede para que o usuário informe um nickname e escolha um dos personagens disponíveis para jogar
- Botão "jogar", que redireciona para `HomeScreen`

## Lista de Salas --> HomeScreen

Consiste em:

- Uma lista com todas as rooms criadas
- Um botão de "refresh" que busca as salas novamente ao ser clicado"

Ao clicar em uma sala (representada por um ID), o usuário vai para a tela de `RoomScreen --> {ROOM_ID}` (sala específica que ele escolheu).
No caso de a sala não estar disponível, ou cheia, um popup deve ser exibido.

## Sala Específica --> RoomScreen

Nessa tela, os usuários aguardam até que o owner da partida autorize o início da partida. Os usuários podem sair da sala (redirecionados para `HomeScreen`), ou aguardar o owner autorizar a partida (e ser redirecionado para `GameScreen`).

O owner pode utilizar esta tela para editar informações/regras da sala (nome, max_players, time, etc...)

## Jogo Rolando --> GameScreen

Aqui é tudo o jogo em si, partida rolando, movimentação, mecânicas definidas e especificadas em outros documentos, etc...
No fim da partida todos os players voltam para `RoomScreen`
