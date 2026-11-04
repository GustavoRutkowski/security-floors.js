# Sistema de Usuários

Cada usuário é gerado dentro do próprio navegador (é de uso único).

O usuário:

- Escolhe um nickname
- Escolhe qual personagem quer utilizar)

O navegador:

- Salva esses dados internamente
- Gera um UUID para o usuário
- Usa esses dados para transitar informações com o WS

O usuário não deve ser persistido no banco de dados. Uma sala pode e deve apontar para o UUID do owner, mas isso não significa que esse UUID precisa ser uma chave-estrangeira.
