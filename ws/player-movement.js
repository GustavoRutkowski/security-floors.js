import { isBlockedAt } from '../map-layout.js';

export const MAP_BOUNDS = Object.freeze({ minX: 0, maxX: 100, minY: 0, maxY: 100 });

export const MOVEMENT_STEP = 2.5;
const COLLISION_RADIUS = 4.1;
const COLLISION_SAMPLE_STEP = 0.5;
const DIAGONAL_STEP = Math.SQRT1_2 * MOVEMENT_STEP;
const DIRECTIONS = Object.freeze({
    north: [0, -MOVEMENT_STEP],
    northeast: [DIAGONAL_STEP, -DIAGONAL_STEP],
    east: [MOVEMENT_STEP, 0],
    southeast: [DIAGONAL_STEP, DIAGONAL_STEP],
    south: [0, MOVEMENT_STEP],
    southwest: [-DIAGONAL_STEP, DIAGONAL_STEP],
    west: [-MOVEMENT_STEP, 0],
    northwest: [-DIAGONAL_STEP, -DIAGONAL_STEP],
    stop: [0, 0]
});

export function isMovementDirection(direction) {
    return typeof direction === 'string' && Object.hasOwn(DIRECTIONS, direction);
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function movePosition(
    position,
    direction,
    { notebooksPerFloor = 1, doorOpen = false } = {}
) {
    if (
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !isMovementDirection(direction)
    ) {
        throw new TypeError('position and movement direction must be valid');
    }

    const [deltaX, deltaY] = DIRECTIONS[direction];
    if (direction === 'stop') return { x: position.x, y: position.y };

    const distance = Math.hypot(deltaX, deltaY);
    const sampleCount = Math.ceil(distance / COLLISION_SAMPLE_STEP);
    let lastValidPosition = position;
    for (let sample = 1; sample <= sampleCount; sample += 1) {
        const progress = sample / sampleCount;
        const candidate = {
            x: clamp(position.x + deltaX * progress, MAP_BOUNDS.minX, MAP_BOUNDS.maxX),
            y: clamp(position.y + deltaY * progress, MAP_BOUNDS.minY, MAP_BOUNDS.maxY)
        };
        if (isBlockedAt(candidate, notebooksPerFloor, COLLISION_RADIUS, { doorOpen })) {
            return lastValidPosition;
        }
        lastValidPosition = candidate;
    }

    return lastValidPosition;
}
