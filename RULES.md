# Regras iniciais do produto

## Salas

- Uma sala tem identificador, nome, owner, modo, configuracao, estado e data de criacao.
- O owner e um UUID de usuario efemero; nao existe persistencia nem tabela de usuarios.
- Se o owner sair, a sala transfere o ownership para o jogador presente ha mais tempo.
- A sala e removida quando seu ultimo jogador sai.
- Andares: inteiro de 3 a 30. Cadernos por andar: inteiro de 1 a 6.
- Modos persistidos: `classic` e `deathmatch`. Mata-mata usa exatamente um caderno por andar.
- `time_limit_seconds` e `NULL` para tempo infinito; caso definido, deve ser pelo menos 60 segundos.
- A sala admite ao menos um jogador; o limite maximo e configurado por sala.

## Partidas e questoes

- O servidor WebSocket valida acoes e e a autoridade para o estado compartilhado e o ranking.
- No classico, uma resposta correta avanca o jogador; se errar todos os cadernos do andar, aguarda a abertura da porta.
- No mata-mata, errar elimina o jogador. A partida termina quando as questoes acabam ou resta um jogador.
- O ranking classico prioriza quem alcanca primeiro o andar final.
- Questões sao de multipla escolha; verdadeiro/falso e representado por duas alternativas. A resposta correta e armazenada como indice baseado em zero.
- Questões contem somente `id`, `prompt`, `options`, `correct_option_index` e `explanation`; nao armazenam modo, andar ou caderno.
- O servidor sorteia em tempo de jogo o andar e o caderno de cada questao. A numeracao e a ordem dos cadernos exibidas podem ser embaralhadas independentemente para cada jogador.
- O catalogo de questoes e compartilhado e reutilizavel nos modos classico e mata-mata.

## Limites de arquitetura do MVP

- SQLite persiste salas e o catalogo de questoes; jogadores, presenca e estado transitorio da partida ficam em memoria no servidor WS.
- O UUID do owner em uma sala nao referencia uma tabela de usuarios.
- Nao ha API HTTP planejada. Express so deve ser considerado quando uma necessidade do produto exigir HTTP.
- O cliente gera e guarda localmente UUID, nickname e personagem; esses dados nao sao gravados no banco.
