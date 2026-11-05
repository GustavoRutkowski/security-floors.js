# Sistema de Rooms

O usuário ao entrar no sistema pode criar uma sala ou entrar em uma sala já existente.

O protocolo de mensagens, payloads, erros e sincronização da sala está definido em [`WEBSOCKET.md`](WEBSOCKET.md). Mudanças na configuração e na quantidade/identidade de participantes são enviadas imediatamente a todos os membros conectados por `room.snapshot`; a lista de salas é consultada sob demanda e periodicamente na Home.

## Criando uma sala

Para criar uma sala o usuário deve:

- Criar uma sala com o botão "+"
- Configurar regras (quantos andares, quantos cadernos por andar, modo de jogo, tempo, limite de players, etc...)
    - Os andares devem ser um valor inteiro de 3 a 30
    - A quantidade de cadernos por andar deve ser um inteiro de 1 a 6
    - O modo de jogo deve ser "clássico" ou "mata-mata"
    - O tempo (em segundos) pode ser qualquer tempo a partir de 1 minuto e também pode ser setado como "infinito"
    - Limite de players (quantidade máxima de jogadores que podem entrar na sala)

## Entrando em uma sala

Para entrar em uma sala, o usuário deve escolher uma das salas na tela inicial e então entrar como jogador (caso haja espaço sobrando). Não existe entrada externa como espectador; o modo espectador é reservado aos jogadores eliminados durante o mata-mata. Vagas desconectadas ficam reservadas por 30 segundos para reconexão.

## Life-Cycle de uma sala

O cilo de vida de uma sala consiste em:

- Sala é criada
- Um UUID de owner é atribuído a sala
- Se o owner sair, esse UUID é atribuído ao player mais antigo que estava na sala
- Se não houverem mais players na sala, a sala deve ser deletada do banco.

## Quanto uma partida acaba

Todos os players são redirecionados para a tela da sala, onde o owner pode autorizar uma nova partida.
