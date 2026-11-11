export const MAP_SIZE = 15;
export const LOGICAL_TILE_SIZE = 100 / MAP_SIZE;

export const TILE_TYPES = Object.freeze({
    0: Object.freeze({ name: 'floor', blocksMovement: false }),
    1: Object.freeze({ name: 'wall', blocksMovement: true }),
    2: Object.freeze({ name: 'door', blocksMovement: true }),
    3: Object.freeze({ name: 'spawn', blocksMovement: false }),
    4: Object.freeze({ name: 'table', blocksMovement: true })
});

export const MAPS = {
    1: [
        '111111222111111',
        '111111222111111',
        '000000000000000',
        '000000000000000',
        '000333333333000',
        '000333333333000',
        '000330000033000',
        '000330000033000',
        '000330040033000',
        '000330000033000',
        '000330000033000',
        '000333333333000',
        '000333333333000',
        '000000000000000',
        '000000000000000'
    ],
    2: [
        '111111222111111',
        '111111222111111',
        '000000000000000',
        '000000000000000',
        '000000000000000',
        '000000000000000',
        '000003333300000',
        '000003333300000',
        '040003333300040',
        '000003333300000',
        '000003333300000',
        '000000000000000',
        '000000000000000',
        '000000000000000',
        '000000000000000'
    ],
    3: [
        '111111222111111',
        '111111222111111',
        '000000000000000',
        '040000000000040',
        '000000000000000',
        '000003333300000',
        '000003333300000',
        '000003333300000',
        '000003333300000',
        '000003333300000',
        '000000000000000',
        '000000000000000',
        '000000000000000',
        '000000040000000',
        '000000000000000'
    ],
    4: [
        '111111222111111',
        '111111222111111',
        '000000000000000',
        '004000000000400',
        '000000000000000',
        '000000000000000',
        '000003333300000',
        '000003333300000',
        '000003333300000',
        '000003333300000',
        '000003333300000',
        '000000000000000',
        '000000000000000',
        '004000000000400',
        '000000000000000'
    ]
};

export function getMap(notebooksPerFloor = 1) {
    return MAPS[notebooksPerFloor] || MAPS[1];
}

export function getTileAt(notebooksPerFloor, row, column) {
    const code = getMap(notebooksPerFloor)[row]?.[column];
    const type = TILE_TYPES[code];
    return type ? { type, row, column } : null;
}

export function isBlockedAt(position, notebooksPerFloor = 1, radius = 0) {
    if (
        position.x - radius < 0 ||
        position.y - radius < 0 ||
        position.x + radius > 100 ||
        position.y + radius > 100
    ) {
        return true;
    }

    const minColumn = Math.floor((position.x - radius) / LOGICAL_TILE_SIZE);
    const maxColumn = Math.floor((position.x + radius) / LOGICAL_TILE_SIZE);
    const minRow = Math.floor((position.y - radius) / LOGICAL_TILE_SIZE);
    const maxRow = Math.floor((position.y + radius) / LOGICAL_TILE_SIZE);
    for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
            const tile = getTileAt(notebooksPerFloor, row, column);
            if (!tile?.type.blocksMovement) continue;

            const tileLeft = tile.column * LOGICAL_TILE_SIZE;
            const tileTop = tile.row * LOGICAL_TILE_SIZE;
            const closestX = Math.max(tileLeft, Math.min(position.x, tileLeft + LOGICAL_TILE_SIZE));
            const closestY = Math.max(tileTop, Math.min(position.y, tileTop + LOGICAL_TILE_SIZE));
            const distanceX = position.x - closestX;
            const distanceY = position.y - closestY;
            if (distanceX ** 2 + distanceY ** 2 < radius ** 2 || radius === 0) return true;
        }
    }
    return false;
}
