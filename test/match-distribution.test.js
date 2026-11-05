import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMatchDistribution, InsufficientQuestionsError } from '../ws/match-distribution.js';

function makeQuestions(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        prompt: `Question ${index + 1}`,
        options: ['A', 'B'],
        correct_option_index: 0,
        explanation: null
    }));
}

describe('match question distribution', () => {
    it('assigns unique questions to every classic slot and permutes notebooks per player', () => {
        const questions = makeQuestions(10);
        const originalQuestions = questions.map(question => ({
            ...question,
            options: [...question.options]
        }));
        const randomValues = [
            ...Array(9).fill(0.5),
            ...Array(6).fill(0),
            ...Array(6).fill(0.999999)
        ];
        const distribution = createMatchDistribution({
            mode: 'classic',
            floors: 3,
            notebooksPerFloor: 3,
            questions,
            playerIds: ['player-1', 'player-2'],
            random: () => randomValues.shift() ?? 0.5
        });

        const assignedQuestionIds = distribution.floors.flatMap(floor =>
            floor.notebooks.map(notebook => notebook.questionId)
        );
        assert.equal(new Set(assignedQuestionIds).size, 9);
        assert.equal(distribution.questions.size, 9);
        assert.deepEqual(questions, originalQuestions);

        for (const playerId of ['player-1', 'player-2']) {
            const playerFloors = distribution.players.get(playerId);
            assert.equal(playerFloors.length, 3);
            for (const playerFloor of playerFloors) {
                assert.deepEqual(
                    playerFloor.notebooks.map(notebook => notebook.notebookLabel),
                    [1, 2, 3]
                );
            }
        }

        assert.notDeepEqual(
            distribution.players.get('player-1')[0].notebooks.map(notebook => notebook.notebookId),
            distribution.players.get('player-2')[0].notebooks.map(notebook => notebook.notebookId)
        );
        const playerOneLabel = distribution.players
            .get('player-1')[0]
            .notebooks.find(notebook => notebook.notebookId === 'floor-1-notebook-1').notebookLabel;
        const playerTwoLabel = distribution.players
            .get('player-2')[0]
            .notebooks.find(notebook => notebook.notebookId === 'floor-1-notebook-1').notebookLabel;
        assert.notEqual(playerOneLabel, playerTwoLabel);
    });

    it('distributes one distinct question per deathmatch floor', () => {
        const distribution = createMatchDistribution({
            mode: 'deathmatch',
            floors: 3,
            notebooksPerFloor: 1,
            questions: makeQuestions(5),
            playerIds: ['player-1'],
            random: () => 0
        });

        assert.equal(distribution.floors.length, 3);
        assert.deepEqual(
            distribution.floors.map(floor => floor.notebooks.length),
            [1, 1, 1]
        );
        assert.equal(
            new Set(distribution.floors.map(floor => floor.notebooks[0].questionId)).size,
            3
        );
    });

    it('rejects a catalog without enough distinct questions', () => {
        assert.throws(
            () =>
                createMatchDistribution({
                    mode: 'classic',
                    floors: 3,
                    notebooksPerFloor: 2,
                    questions: makeQuestions(5),
                    playerIds: ['player-1'],
                    random: () => 0
                }),
            error =>
                error instanceof InsufficientQuestionsError &&
                error.code === 'INSUFFICIENT_QUESTIONS'
        );
    });
});
