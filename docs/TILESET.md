# Tileset e mapas do jogo

Este documento define a representação lógica dos mapas e a organização visual
do tileset usado na cena de jogo. Ele é a referência para a implementação do
cenário, da porta, dos cadernos e dos pontos de surgimento dos jogadores.

## Dimensões e convenções do mapa

Todo mapa possui exatamente **15 colunas por 15 linhas**. Cada caractere de
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

Na colisão, cada célula é interpretada pelo seu tipo: `0` (piso) e `3`
(surgimento) permitem passagem; `1` (parede), `2` (porta) e `4` (caderno)
têm colisão somente na metade superior do tile, considerando a perspectiva
oblíqua. A metade inferior permite passagem. A colisão considera o volume do
personagem contra essa área, e o movimento termina na última posição livre
antes do obstáculo.

## Mapas por quantidade de cadernos

Salas configuram de um a quatro cadernos por andar; cada quantidade possui um
mapa correspondente abaixo. Para interagir, o cliente usa a posição do tile
informada com a questão atual e mantém a interação dentro do canvas e do
teclado.

As matrizes abaixo são mapas de referência. Os espaços em branco não fazem
parte das matrizes e cada linha deve permanecer com 15 caracteres.

### Quatro cadernos

```text
111111222111111
111111222111111
000000000000000
004000000000400
000000000000000
000000000000000
000003333300000
000003333300000
000003333300000
000003333300000
000003333300000
000000000000000
000000000000000
004000000000400
000000000000000
```

### Três cadernos

```text
111111222111111
111111222111111
000000000000000
040000000000040
000000000000000
000003333300000
000003333300000
000003333300000
000003333300000
000003333300000
000000000000000
000000000000000
000000000000000
000000040000000
000000000000000
```

### Dois cadernos

```text
111111222111111
111111222111111
000000000000000
000000000000000
000000000000000
000000000000000
000003333300000
000003333300000
040003333300040
000003333300000
000003333300000
000000000000000
000000000000000
000000000000000
000000000000000
```

### Um caderno

```text
111111222111111
111111222111111
000000000000000
000000000000000
000333333333000
000333333333000
000330000033000
000330000033000
000330040033000
000330000033000
000330000033000
000333333333000
000333333333000
000000000000000
000000000000000
```

## Organização da spritesheet

O arquivo [`web/spritesheets/TILESET.png`](../web/spritesheets/TILESET.png)
mede 48×128 pixels e contém uma grade de 3 colunas por 8 linhas de tiles de
16×16 pixels. Os frames são indexados da esquerda para a direita e de cima
para baixo, começando em zero. A ordem, da primeira à última linha, é:

```js
[
    [FLOOR, WALL, null],
    [TABLE, EMPTY_TABLE, null],
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
- `EMPTY_TABLE`: mesa sem a folha do caderno;
- `DOOR_LOCKED_1` a `DOOR_LOCKED_6`: porta fechada;
- `DOOR_MID_1` a `DOOR_MID_6`: porta em abertura;
- `DOOR_OPEN_1` a `DOOR_OPEN_6`: porta aberta.

Os índices de frame são: `FLOOR` 0, `WALL` 1, `TABLE` 3, `EMPTY_TABLE` 4,
porta fechada 6–11, porta em abertura 12–17 e porta aberta 18–23. Quando um
jogador erra uma questão, somente a mesa daquele caderno passa a usar
`EMPTY_TABLE`; ao acertar, todas as mesas perdem a folha. Cada estado da porta
e formado por seis tiles em uma composicao de 3×2, totalizando 48×32 pixels.
O codigo logico `2` da matriz representa essa composicao inteira; ele nao deve
ser interpretado como seis celulas independentes nem substituido por seis
codigos diferentes no mapa.

O estado visual da porta deve acompanhar o estado autoritativo recebido do
servidor. Ao abrir, a cena anima a composição `DOOR_LOCKED` → `DOOR_MID` →
`DOOR_OPEN`; a regra que libera a passagem pertence à lógica da partida.
Os índices de matriz usados pelo protocolo e pela implementação começam em
zero: a porta ocupa `[0..1][6..8]`. Quando o servidor confirma a travessia,
o jogador entra no próximo andar no tile `[14][7]`.
