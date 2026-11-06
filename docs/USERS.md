# Sistema de Usuários

Cada usuário é gerado dentro do próprio navegador e é anônimo; não há tabela de usuários.

O usuário:

- Escolhe um nickname
- Escolhe qual personagem quer utilizar

O navegador:

- Gera um UUID v4 usando a API de criptografia do navegador na primeira gravação
- Salva `user_id`, `nickname` e `character_id` em `localStorage`, na chave `security-floors.profile.v1`
- Preserva o UUID ao editar o nickname ou personagem
- Usa esses dados para transitar informações com o WS

O usuário não deve ser persistido no banco de dados. Uma sala pode e deve apontar para o UUID do owner, mas isso não significa que esse UUID precisa ser uma chave-estrangeira.

Nicknames são removidos de espaços externos e devem conter de 1 a 32 caracteres, conforme a validação de sessão do servidor. `character_id` deve ser um dos IDs documentados em [`SPRITESHEETS.md`](SPRITESHEETS.md). O evento local `security-floors:profile-ready` disponibiliza o perfil à integração de cliente; o perfil ainda não abre uma conexão WebSocket nesta etapa.
