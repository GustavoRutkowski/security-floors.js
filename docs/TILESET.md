# Tileset e mapas do jogo

Este documento define a representação lógica dos mapas e a organização visual
do tileset usado na cena de jogo. Ele é a referência para a implementação do
cenário, da porta, dos cadernos e dos pontos de surgimento dos jogadores.

## Dimensões e convenções do mapa

Todo mapa possui exatamente **25 colunas por 25 linhas**. Cada caractere de
uma matriz representa um tile de 16×16 pixels. As linhas e colunas são
indexadas a partir de 1 nesta documentação.

O mapa é uma camada lógica. O servidor continua responsável por validar
movimento, colisões, surgimento e progressão da partida; o cliente usa essa
camada para renderizar o cenário.

### Legenda

| Código | Elemento lógico     | Renderização               | Regra de uso                                                                                       |
| ------ | ------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| `0`    | Piso                | `FLOOR`                    | Área livre para circulação.                                                                        |
| `1`    | Parede              | `WALL`                     | Área sólida, sem circulação.                                                                       |
| `2`    | Porta               | Composição visual da porta | A porta ocupa três colunas por duas linhas e é a passagem para o andar seguinte.                   |
| `3`    | Ponto de surgimento | `FLOOR`                    | Área livre visualmente. O servidor pode escolher jogadores somente nesses tiles no primeiro andar. |
| `4`    | Caderno             | `TABLE`                    | Posição de um caderno/questão. A interação e a distribuição das questões são regras do servidor.   |

Os tiles `3` não possuem sprite próprio: devem ser desenhados como piso. Nos
andares seguintes, o personagem começa na posição correspondente à porta do
andar anterior, conforme o estado enviado pelo servidor.

## Mapas por quantidade de cadernos

As matrizes abaixo são mapas de referência. Os espaços em branco não fazem
parte das matrizes e cada linha deve permanecer com 25 caracteres.

### Quatro cadernos

```text
1111111111122211111111111
1111111111122211111111111
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000400000000040000000
0000000000000000000000000
0000000000000000000000000
0000000000333330000000000
0000000000333330000000000
0000000000333330000000000
0000000000333330000000000
0000000000333330000000000
0000000000000000000000000
0000000000000000000000000
0000000400000000040000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
```

### Três cadernos

```text
1111111111122211111111111
1111111111122211111111111
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000004000000000004000000
0000000000000000000000000
0000000000000000000000000
0000000000333330000000000
0000000000333330000000000
0000000000333330000000000
0000000000333330000000000
0000000000333330000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000004000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
```

### Dois cadernos

```text
1111111111122211111111111
1111111111122211111111111
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000333330000000000
0000000000333330000000000
0000040000333330000400000
0000000000333330000000000
0000000000333330000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
```

### Um caderno

```text
1111111111122211111111111
1111111111122211111111111
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000033333333300000000
0000000033333333300000000
0000000033000003300000000
0000000033000003300000000
0000000033004003300000000
0000000033000003300000000
0000000033000003300000000
0000000033333333300000000
0000000033333333300000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
0000000000000000000000000
```

## Organização da spritesheet

O arquivo [`web/spritesheets/TILESET.png`](../web/spritesheets/TILESET.png)
mede 48×112 pixels e contém uma grade de 3 colunas por 7 linhas de tiles de
16×16 pixels. A ordem dos tiles, da primeira à última linha, é:

```js
[
    [FLOOR, WALL, TABLE],
    [DOOR_LOCKED_1, DOOR_LOCKED_2, DOOR_LOCKED_3],
    [DOOR_LOCKED_4, DOOR_LOCKED_5, DOOR_LOCKED_6],
    [DOOR_MID_1, DOOR_MID_2, DOOR_MID_3],
    [DOOR_MID_4, DOOR_MID_5, DOOR_MID_6],
    [DOOR_OPEN_1, DOOR_OPEN_2, DOOR_OPEN_3],
    [DOOR_OPEN_4, DOOR_OPEN_5, DOOR_OPEN_6]
];
```

Os nomes representam:

- `FLOOR`: piso;
- `WALL`: parede;
- `TABLE`: caderno;
- `DOOR_LOCKED_1` a `DOOR_LOCKED_6`: porta fechada;
- `DOOR_MID_1` a `DOOR_MID_6`: porta em abertura;
- `DOOR_OPEN_1` a `DOOR_OPEN_6`: porta aberta.

Cada estado da porta é formado por seis tiles em uma composição de 3×2,
totalizando 48×32 pixels. O código lógico `2` da matriz representa essa
composição inteira; ele não deve ser interpretado como seis células
independentes nem substituído por seis códigos diferentes no mapa.

O estado visual da porta deve acompanhar o estado autoritativo recebido do
servidor. A spritesheet também contém os estados necessários para uma
animação, mas a regra que libera a passagem pertence à lógica da partida.
