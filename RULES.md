# Regras iniciais do produto

## Salas

- Uma sala tem identificador, nome, owner, modo, configuracao, estado e data de criacao.
- O owner e um UUID de usuario efemero; nao existe persistencia nem tabela de usuarios.
- Se o owner sair, a sala transfere o ownership para o jogador presente ha mais tempo.
- A sala e removida quando seu ultimo jogador sai.
- Andares: inteiro de 3 a 30. Cadernos por andar: inteiro de 1 a 4.
- Modos persistidos: `classic` e `deathmatch`. Mata-mata usa exatamente um caderno por andar.
- `time_limit_seconds` e `NULL` para tempo infinito; caso definido, deve ser pelo menos 60 segundos.
- A sala admite ao menos um jogador; o limite maximo e configurado por sala. Uma partida exige pelo menos dois jogadores para começar.
- Toda entrada na sala e como jogador; nao existe entrada externa somente para assistir nem limite separado de espectadores. Jogadores eliminados podem assistir a partida conforme a regra abaixo e continuam ocupando sua vaga ate o fim.

## Partidas e questoes

- O servidor WebSocket valida acoes e e a autoridade para o estado compartilhado e o ranking.
- No classico, o servidor apresenta ao jogador os cadernos do andar na ordem individual sorteada para ele. Uma resposta correta em qualquer caderno abre a porta; o jogador avanca ao entrar nela. Cada caderno so pode ser respondido uma vez por andar; se todas as respostas estiverem erradas, a porta abre apos 5 segundos e o jogador deve atravessa-la. A resposta correta no ultimo andar conclui o progresso do jogador.
- No classico, a partida encerra assim que todos os jogadores concluem o ultimo andar ou quando o limite de tempo e atingido. `time_limit_seconds: null` significa que nao ha cronometro.
- No mata-mata, cada andar tem exatamente um caderno. Errar elimina imediatamente o jogador e o converte em espectador. Acertar no ultimo andar encerra a partida com esse jogador como vencedor (`questions_exhausted`); eliminar um jogador e deixar exatamente um competidor ativo e conectado encerra com esse sobrevivente como vencedor (`last_player_standing`). Se a expiracao de reconexao eliminar o ultimo competidor ativo, o jogador que acabou de expirar vence por ausencia de adversarios (`last_player_disconnected`). Se todos forem eliminados por resposta incorreta, a partida termina sem vencedor (`no_players_remaining`).
- No mata-mata, uma resposta correta antes do ultimo andar abre a porta, e o jogador precisa atravessa-la para prosseguir. Uma resposta correta no ultimo andar encerra a partida normalmente.
- O ranking classico prioriza quem alcanca primeiro o andar final.
- Questões sao de multipla escolha; verdadeiro/falso e representado por duas alternativas. A resposta correta e armazenada como indice baseado em zero.
- Questões contem somente `id`, `prompt`, `options`, `correct_option_index` e `explanation`; nao armazenam modo, andar ou caderno.
- Ao iniciar uma partida, o servidor sorteia questoes distintas para cada slot de andar/caderno, sem persistir posicionamentos no catalogo. A numeracao e a ordem dos cadernos exibidas sao embaralhadas independentemente por jogador e por andar; a distribuicao e as respostas corretas permanecem somente na memoria do servidor.
- O catalogo de questoes e compartilhado e reutilizavel nos modos classico e mata-mata.

## Casos de borda do MVP

### Desconexao e reconexao

- Uma desconexao reserva por 30 segundos a vaga e o estado do jogador na sala/partida. Durante esse prazo, o jogador nao pode enviar acoes; a partida e o cronometro continuam normalmente.
- O cliente pode retomar a sessao enviando `session.hello` com o mesmo UUID dentro dos 30 segundos. O servidor reassocia a conexao e envia snapshots atuais da sala e, se aplicavel, da partida. A nova conexao substitui a anterior para aquele UUID.
- Se o prazo expirar no lobby ou no modo classico, a desconexao e tratada como saida da sala: remove-se a presenca e atualiza-se a sala normalmente.
- No mata-mata, se o jogador nao voltar em 30 segundos, ele e eliminado por desconexao e passa ao modo espectador ate o fim da partida. Se a expiracao deixar a partida sem nenhum outro competidor ativo, esse ultimo jogador a desconectar vence por ausencia de adversarios e pode ficar sem alvo de espectador.

### Owner desconectado durante a partida

- A queda do owner nao pausa nem encerra a partida. Ele mantem a propriedade durante a tolerancia de reconexao de 30 segundos.
- Se nao voltar nesse prazo, a propriedade passa ao jogador conectado ha mais tempo, inclusive se ele estiver eliminado e assistindo. A propriedade nao concede controles de jogo durante a partida; vale para o lobby seguinte.
- Se nao restar nenhum jogador conectado quando as tolerancias expirarem, a sala e removida conforme a regra de sala vazia.

### Espectadores apos eliminacao

- Somente jogadores que ja participam da partida podem assistir; nao se pode entrar na sala ou partida com papel de espectador.
- No mata-mata, uma eliminacao por resposta incorreta ou desconexao expirado torna o jogador invisivel aos jogadores ativos e muda sua visualizacao para espectador.
- O espectador pode acompanhar o campo de visao de qualquer jogador ainda ativo. Ele nao se move, nao responde questoes, nao altera o ranking e continua ocupando sua vaga ate a partida terminar.
- Se nao restar nenhum outro competidor ativo quando uma tolerancia de reconexao expirar, o jogador que acabou de expirar e declarado vencedor; o motivo de fim e `last_player_disconnected`.
- Ao fim da partida, todos os participantes, inclusive eliminados que estejam conectados, retornam ao lobby.

### Ranking e desempate

- O servidor calcula e ordena o ranking; clientes nao enviam pontuacao ou colocacao.
- No modo classico, jogadores em andares diferentes sao ordenados pelo maior progresso. Quem conclui a partida primeiro fica a frente; para progresso equivalente, vale a ordem em que o servidor registrou a chegada ao andar. A ordem de entrada na sala e o desempate final.
- No mata-mata, o jogador declarado vencedor por ser o ultimo ativo ou o ultimo a desconectar fica em primeiro. Nos demais lugares, jogadores ainda ativos ficam a frente dos eliminados; entre eliminados, quem sobreviveu por mais tempo fica a frente. Progresso registrado pelo servidor e, por fim, ordem de entrada resolvem empates restantes.

### Limite de tempo

- O limite comeca quando o servidor inicia a partida; `NULL` significa que nao ha deadline.
- Uma acao so e valida se o servidor a processar antes do deadline (`now < deadline`). No deadline ou depois dele, o timeout prevalece e nenhuma resposta ou movimento pode alterar o resultado.
- A verificacao do deadline ocorre antes de aplicar a acao, tornando deterministica a corrida entre timeout e ultima resposta.

### Catalogo insuficiente

- Antes de iniciar, o servidor exige questoes distintas suficientes para todos os espacos da partida: `floors * notebooks_per_floor` no classico e `floors` no mata-mata.
- Se o catalogo nao for suficiente, `match.start` falha com `INSUFFICIENT_QUESTIONS`; a sala permanece aguardando e nenhuma questao e repetida para completar a partida.

### Ordem individual de cadernos

- No inicio de cada partida, cada jogador recebe sua propria permutacao aleatoria dos cadernos e seus rotulos. Essa permutacao permanece fixa ate o fim da partida e pode diferir da dos demais jogadores.
- A permutacao muda somente a identidade/ordem apresentada ao jogador; o servidor continua autoridade sobre as questoes atribuidas e as respostas corretas.

## Limites de arquitetura do MVP

- SQLite persiste salas e o catalogo de questoes; jogadores, presenca e estado transitorio da partida ficam em memoria no servidor WS.
- O UUID do owner em uma sala nao referencia uma tabela de usuarios.
- Nao ha API HTTP planejada. Express so deve ser considerado quando uma necessidade do produto exigir HTTP.
- O cliente gera e guarda localmente UUID, nickname e personagem; esses dados nao sao gravados no banco.
