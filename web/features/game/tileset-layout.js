export const TILESET_TILE_SIZE = 16;
export const TILESET_COLUMNS = 3;
export const TILESET_ROWS = 8;

export const TILESET_FRAME = Object.freeze({
    floor: 0,
    wall: 1,
    table: 3,
    emptyTable: 4,
    doorLocked: 6,
    doorMid: 12,
    doorOpen: 18
});

export function getNotebookFrame({ answered, clearAll }) {
    return answered || clearAll ? TILESET_FRAME.emptyTable : TILESET_FRAME.table;
}
