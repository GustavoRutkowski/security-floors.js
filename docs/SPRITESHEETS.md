# Folhas de Sprites

Cada personagem selecionável é descrito em [`web/characters.json`](../web/characters.json), que define seu ID, nome e arquivo de sprite. Para adicionar um personagem, coloque a nova folha em `web/spritesheets/` e adicione uma entrada ao catálogo JSON.

Todas as folhas seguem a seguinte regra:

- 16px de largura
- 48px de altura
- 16x16 cada frame
- O primeiro frame (de cima pra baixo) deve ser reaproveitado como frame de `standing`, enquanto os 3 frames devem ser utilizados para fazer uma animação de `walking`

Os sprites atualmente disponíveis são:

- `web/spritesheets/bobabao.png`
- `web/spritesheets/carlos.png`
- `web/spritesheets/dr.vultu.png`
- `web/spritesheets/eteubaldo.png`
- `web/spritesheets/lixaredo.png`
- `web/spritesheets/nefasto.png`
- `web/spritesheets/plantosca.png`
- `web/spritesheets/resmungossauro.png`
- `web/spritesheets/rinocornio.png`
- `web/spritesheets/robotudo.png`
- `web/spritesheets/tubarina.png`
- `web/spritesheets/verme_d._goma.png` (nome exibido: Verne D. Goma)
- `web/spritesheets/zoiuda.png`
