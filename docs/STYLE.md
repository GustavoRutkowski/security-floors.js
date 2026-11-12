# Estilo de Arte e Spritesheets

As spritesheets dos personagens estão em `/web/spritesheets/characters` e são listadas em `web/characters.json`. Cada arquivo mede 16x48px e contém três frames verticais de 16x16; o primeiro frame é usado como standing e os três frames compõem walking. A tela de perfil exibe os personagens com nearest-neighbor e animação pixelada. Consulte [`SPRITESHEETS.md`](SPRITESHEETS.md) para a lista e convenção dos arquivos.

O jogo será 2D e terá uma visão de cima (movimentação em 8 direções, sem gravidade)

Para texto e elementos visuais como Pop-ups ou menûs, devemos sempre trabalhar com um estilo retro e pixelado. Use no canvas a mesma fonte `Press Start 2P` declarada no CSS. Mantenha uma resolução lógica fixa de 480 × 480 no canvas e ajuste sua exibição com `FIT`, preservando a proporção em qualquer contêiner. O painel de questão deve ser centralizado e limitado a 98% da largura e da altura do canvas; separe visualmente o enunciado e as alternativas e ajuste o texto para mantê-lo legível sem cortes.
