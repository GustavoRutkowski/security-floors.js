# Telas do Jogo

## Perfil (Tela Inicial) --> ProfileScreen

Consiste em:

- Menu inicial que pede para que o usuário informe um nickname e escolha um dos personagens disponíveis para jogar
- Botão "jogar", que redireciona para `HomeScreen`

## Lista de Salas --> HomeScreen

Consiste em:

- Uma lista com todas as rooms criadas
- Um botão de "refresh" que busca as salas novamente ao ser clicado"
- Um botão para criar uma nova room, com nome, modo, andares, cadernos, tempo e limite de jogadores
- Buscar a lista ao abrir a tela e atualizá-la automaticamente a cada 15 segundos enquanto ela estiver visível; parar o polling ao sair da tela

A consulta é feita pelo evento `rooms.list.request` do contrato em `WEBSOCKET.md`. A lista não é transmitida em tempo real; a entrada na sala sempre é revalidada pelo servidor.

Ao clicar em uma sala (representada por um ID), o usuário vai para a tela de `RoomScreen --> {ROOM_ID}` (sala específica que ele escolheu).
No caso de a sala não estar disponível, ou cheia, um popup deve ser exibido.

## Sala Específica --> RoomScreen

Nessa tela, os usuários aguardam até que o owner da partida autorize o início da partida. Os usuários podem sair da sala (redirecionados para `HomeScreen`), ou aguardar o owner autorizar a partida (e ser redirecionado para `GameScreen`). O owner pode editar a configuração da room e iniciar a partida; os demais participantes acompanham a configuração e a lista de jogadores em tempo real.

O owner pode utilizar esta tela para editar informações/regras da sala (nome, max_players, time, etc...)

Alterações de regras e de participantes são transmitidas imediatamente a todos na sala por `room.snapshot`.

## Jogo Rolando --> GameScreen

Aqui é tudo o jogo em si, partida rolando, movimentação, mecânicas definidas e especificadas em outros documentos, etc...
No fim da partida todos os players voltam para `RoomScreen`

A cena usa um mapa top-down pixelado com câmera acompanhando o jogador local. O cliente envia somente intenções de direção em oito sentidos; posições, sequência aceita e jogadores visíveis são recebidos do servidor por `match.snapshot` e `player.moved`.

O canvas usa resolução lógica fixa de 480 × 480; o Phaser ajusta sua exibição ao contêiner com `FIT`, mantendo a proporção. Todos os cadernos disponíveis podem ser acessados ao se aproximar de seus tiles; `PRESS E TO INTERACT` aparece ao lado de um caderno disponível. O painel ocupa 98% da largura e da altura do canvas, é centralizado e usa a fonte pixelada definida no CSS. Enunciado e alternativas aparecem em blocos separados, com texto ajustado para caber sem cortes. Setas navegam entre alternativas, `E` confirma e `[X]`/`Esc` fecham; não há interação por mouse. Uma resposta errada bloqueia apenas o caderno respondido; uma resposta correta bloqueia todos os cadernos restantes e abre a porta. Cadernos bloqueados exibem um aviso ao tentar interagir novamente.

Uma resposta correta fecha o painel e abre a porta com a animação `DOOR_OPENING`. Após a porta abrir, o jogador precisa caminhar até qualquer tile da porta para entrar no próximo andar; a posição inicial do novo andar é o tile de índice zero-based `[14][7]`, com a porta seguinte fechada. Se todas as respostas do andar clássico estiverem erradas, a porta abre após cinco segundos e também precisa ser atravessada.

Movimentos aceitos e mudanças no ranking são transmitidos imediatamente por `player.moved` e `ranking.updated`, respectivamente. O ranking permanece visível durante toda a partida, ordenado pelo andar mais alto e pela ordem de chegada a cada andar. O servidor valida a abertura da porta e a transição de andar. Cada jogador vê somente participantes no mesmo andar; ao trocar de andar, snapshots removem os avatares que deixaram de estar visíveis. O contrato completo está em `WEBSOCKET.md`.

Ao atravessar a porta do último andar, o jogador conclui a run e vira espectador; no mata-mata, uma resposta incorreta também elimina e transforma o jogador em espectador. O espectador não pode mover-se ou responder questões. A câmera acompanha o jogador selecionado em uma área de 5 × 5 tiles centrada nele. Setas esquerda/direita trocam o alvo, e um indicador no rodapé do canvas mostra quem está sendo acompanhado. Não há entrada na sala com a finalidade de assistir.
