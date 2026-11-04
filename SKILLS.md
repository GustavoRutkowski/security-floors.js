# Competencias e procedimentos do projeto

## Entender o produto

- Consulte `README.md` para o MVP e `docs/ROOMS.md`, `docs/USERS.md`, `docs/SCREENS.md` e `docs/STYLE.md` para os fluxos e limites definidos.
- Trate `RULES.md` como resumo das invariantes de produto; em caso de divergencia, sinalize-a em vez de escolher silenciosamente.

## Backend e sincronizacao

- Mantenha o servidor WebSocket como autoridade sobre presenca, dono da sala, inicio/fim da partida, movimento validado e placar.
- Nao persista jogadores, nicknames, personagens ou estado temporario da partida no SQLite.
- Transfira a propriedade para o jogador conectado ha mais tempo quando o owner sair; remova a sala quando nao houver jogadores.
- Evite endpoints HTTP e frameworks adicionais ate existir uma necessidade concreta.

## Dados

- Reutilize a conexao unica de `db/connection.js` e o schema em `db/schema.sql`.
- Armazene alternativas de questoes como array JSON; `correct_option_index` e baseado em zero.
- Questões contem somente `id`, `prompt`, `options`, `correct_option_index` e `explanation`; nao persistem modo, andar ou caderno.
- O servidor sorteia a distribuicao por andar/caderno durante a partida e pode embaralhar a numeracao/ordem exibida por jogador. O modo pertence a sala; o catalogo e reutilizavel nos dois modos.
- Use `NULL` em `time_limit_seconds` para partidas sem limite de tempo.
- Use statements parametrizados do `better-sqlite3` para valores externos.

## Qualidade

- Prefira validacao focada nos arquivos ou comportamento alterados antes de ampliar os testes.
- Mantenha o codigo simples e a configuracao coerente com JavaScript puro, ES modules e as ferramentas ja instaladas.
- Ao alterar o setup, documente no README como instalar e executar o projeto. Rode `npm run lint` e `npm run format:check` antes de concluir; se aplicar formatacao, repita `format:check`.
