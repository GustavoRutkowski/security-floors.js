export const MAP_BOUNDS = Object.freeze({ minX: 0, maxX: 100, minY: 0, maxY: 100 });

const DIAGONAL_STEP = Math.SQRT1_2;
const DIRECTIONS = Object.freeze({
    north: [0, -1],
    northeast: [DIAGONAL_STEP, -DIAGONAL_STEP],
    east: [1, 0],
    southeast: [DIAGONAL_STEP, DIAGONAL_STEP],
    south: [0, 1],
    southwest: [-DIAGONAL_STEP, DIAGONAL_STEP],
    west: [-1, 0],
    northwest: [-DIAGONAL_STEP, -DIAGONAL_STEP],
    stop: [0, 0]
});

export function isMovementDirection(direction) {
    return typeof direction === 'string' && Object.hasOwn(DIRECTIONS, direction);
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function movePosition(position, direction) {
    if (
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !isMovementDirection(direction)
    ) {
        throw new TypeError('position and movement direction must be valid');
    }

    const [deltaX, deltaY] = DIRECTIONS[direction];
    return {
        x: clamp(position.x + deltaX, MAP_BOUNDS.minX, MAP_BOUNDS.maxX),
        y: clamp(position.y + deltaY, MAP_BOUNDS.minY, MAP_BOUNDS.maxY)
    };
}
