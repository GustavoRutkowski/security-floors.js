export class InsufficientQuestionsError extends RangeError {
    constructor(requiredCount, availableCount) {
        super(`Match requires ${requiredCount} distinct questions; catalog has ${availableCount}`);
        this.name = 'InsufficientQuestionsError';
        this.code = 'INSUFFICIENT_QUESTIONS';
    }
}

function shuffle(items, random) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const sample = random();
        if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0 || sample >= 1) {
            throw new RangeError('random must return a number between 0 and 1');
        }

        const swapIndex = Math.floor(sample * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

export function createMatchDistribution({
    mode,
    floors,
    notebooksPerFloor,
    questions,
    playerIds,
    random = Math.random
}) {
    if (mode !== 'classic' && mode !== 'deathmatch') {
        throw new RangeError('mode must be classic or deathmatch');
    }
    if (!Number.isSafeInteger(floors) || floors < 1) {
        throw new RangeError('floors must be a positive integer');
    }
    if (!Number.isSafeInteger(notebooksPerFloor) || notebooksPerFloor < 1) {
        throw new RangeError('notebooksPerFloor must be a positive integer');
    }
    if (mode === 'deathmatch' && notebooksPerFloor !== 1) {
        throw new RangeError('deathmatch requires exactly one notebook per floor');
    }
    if (!Array.isArray(questions) || !Array.isArray(playerIds)) {
        throw new TypeError('questions and playerIds must be arrays');
    }
    if (typeof random !== 'function') {
        throw new TypeError('random must be a function');
    }
    if (
        playerIds.some(playerId => typeof playerId !== 'string' || playerId.trim() === '') ||
        new Set(playerIds).size !== playerIds.length
    ) {
        throw new TypeError('playerIds must contain unique non-empty strings');
    }

    const questionIds = new Set();
    for (const question of questions) {
        if (!question || !Number.isSafeInteger(question.id) || questionIds.has(question.id)) {
            throw new TypeError('questions must have unique integer ids');
        }
        questionIds.add(question.id);
    }

    const requiredCount = floors * (mode === 'classic' ? notebooksPerFloor : 1);
    if (!Number.isSafeInteger(requiredCount)) {
        throw new RangeError('match question count exceeds the supported range');
    }
    if (questions.length < requiredCount) {
        throw new InsufficientQuestionsError(requiredCount, questions.length);
    }

    const selectedQuestions = shuffle(questions, random).slice(0, requiredCount);
    const questionsById = new Map(
        selectedQuestions.map(question => [
            question.id,
            { ...question, options: [...question.options] }
        ])
    );
    let questionIndex = 0;
    const floorsDistribution = Array.from({ length: floors }, (_, floorIndex) => ({
        floor: floorIndex + 1,
        notebooks: Array.from({ length: notebooksPerFloor }, (_, notebookIndex) => ({
            notebookId: `floor-${floorIndex + 1}-notebook-${notebookIndex + 1}`,
            questionId: selectedQuestions[questionIndex++].id
        }))
    }));

    const players = new Map(
        playerIds.map(playerId => [
            playerId,
            floorsDistribution.map(({ floor, notebooks }) => ({
                floor,
                notebooks: shuffle(notebooks, random).map((notebook, index) => ({
                    notebookId: notebook.notebookId,
                    questionId: notebook.questionId,
                    notebookLabel: index + 1
                }))
            }))
        ])
    );

    return {
        mode,
        notebooksPerFloor,
        floors: floorsDistribution,
        questions: questionsById,
        players,
        movementRevision: 0,
        movement: new Map(
            playerIds.map(playerId => [playerId, { x: 50, y: 80, direction: 'stop', sequence: -1 }])
        ),
        progress: new Map(
            playerIds.map(playerId => [
                playerId,
                {
                    floor: 1,
                    floorReachedAt: null,
                    floorReachedOrder: 0,
                    notebookIndex: 0,
                    answeredNotebooks: [],
                    status: 'playing',
                    doorOpen: false,
                    finishedAt: null,
                    finishedOrder: null,
                    doorOpensAt: null,
                    doorTimer: null
                }
            ])
        ),
        startedAt: null,
        deadline: null,
        timeoutTimer: null,
        progressionRevision: 0,
        rankingRevision: 0,
        ended: false,
        endReason: null,
        winnerUserId: null,
        eliminationOrder: []
    };
}
