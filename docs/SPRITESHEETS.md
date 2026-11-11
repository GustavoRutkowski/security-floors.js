# Folhas de Sprites

Cada personagem selecionável é descrito em [`web/characters.json`](../web/characters.json), que define seu ID, nome e arquivo de sprite. Para adicionar um personagem, coloque uma folha PNG em `web/spritesheets/characters/` e adicione uma entrada correspondente ao catálogo JSON. A seleção de perfil e os assets do jogo são gerados desse catálogo; testes verificam se os arquivos da pasta e os nomes registrados correspondem exatamente. `bobabao` deve permanecer no catálogo porque é o personagem padrão.

Todas as folhas seguem a seguinte regra:

- 16px de largura
- 48px de altura
- 16x16 cada frame
- O primeiro frame (de cima pra baixo) deve ser reaproveitado como frame de `standing`, enquanto os 3 frames devem ser utilizados para fazer uma animação de `walking`

Os sprites atualmente disponíveis são:

- `web/spritesheets/characters/bobabao.png`
- `web/spritesheets/characters/carlos.png`
- `web/spritesheets/characters/dr.vultu.png`
- `web/spritesheets/characters/eteubaldo.png`
- `web/spritesheets/characters/lixaredo.png`
- `web/spritesheets/characters/nefasto.png`
- `web/spritesheets/characters/plantosca.png`
- `web/spritesheets/characters/resmungossauro.png`
- `web/spritesheets/characters/rinocornio.png`
- `web/spritesheets/characters/robotudo.png`
- `web/spritesheets/characters/tubarina.png`
- `web/spritesheets/characters/verme_d._goma.png` (nome exibido: Verme D. Goma)
- `web/spritesheets/characters/zoiuda.png`
