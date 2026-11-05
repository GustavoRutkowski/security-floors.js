import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { syncQuestionCatalog, validateQuestionCatalog } from '../db/questions.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const exampleQuestions = JSON.parse(
    readFileSync(new URL('../db/questions.example.json', import.meta.url), 'utf8')
);
const questionFields = ['id', 'prompt', 'options', 'correct_option_index', 'explanation'].sort();

let database;

beforeEach(() => {
    database = new Database(':memory:');
    database.exec(schema);
});

afterEach(() => {
    database.close();
});

describe('database bootstrap', () => {
    it('creates the schema idempotently', () => {
        database.exec(schema);

        const tables = database
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
            .all()
            .map(row => row.name)
            .sort();
        const indexes = database
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'rooms_status_created_at_idx'"
            )
            .all();

        assert.deepEqual(tables, ['questions', 'rooms']);
        assert.equal(indexes.length, 1);
    });

    it('enforces valid alternatives and an in-range correct answer in SQLite', () => {
        const insertQuestion = database.prepare(`
            INSERT INTO questions (id, prompt, options, correct_option_index)
            VALUES (?, ?, ?, ?)
        `);

        assert.throws(
            () => insertQuestion.run(1, 'Too few options', JSON.stringify(['Only one']), 0),
            /CHECK constraint failed/
        );
        assert.throws(
            () => insertQuestion.run(2, 'Index out of range', JSON.stringify(['A', 'B']), 2),
            /CHECK constraint failed/
        );
    });

    it('validates the exact five-field format in the example catalog', () => {
        for (const question of exampleQuestions) {
            assert.deepEqual(Object.keys(question).sort(), questionFields);
        }

        assert.doesNotThrow(() => validateQuestionCatalog(exampleQuestions));
    });

    it('rejects invalid alternatives and correct-answer indexes', () => {
        const question = exampleQuestions[0];

        assert.throws(
            () => validateQuestionCatalog([{ ...question, options: ['Only one'] }]),
            /at least two non-empty options/
        );
        assert.throws(
            () => validateQuestionCatalog([{ ...question, options: ['A', ''] }]),
            /at least two non-empty options/
        );
        assert.throws(
            () => validateQuestionCatalog([{ ...question, correct_option_index: -1 }]),
            /invalid correct_option_index/
        );
        assert.throws(
            () => validateQuestionCatalog([{ ...question, correct_option_index: 1.5 }]),
            /invalid correct_option_index/
        );
        assert.throws(
            () =>
                validateQuestionCatalog([
                    { ...question, correct_option_index: question.options.length }
                ]),
            /invalid correct_option_index/
        );
    });

    it('loads the catalog idempotently and synchronizes updates and removals', () => {
        syncQuestionCatalog(database, exampleQuestions);
        const firstLoad = database.prepare('SELECT * FROM questions ORDER BY id').all();

        syncQuestionCatalog(database, exampleQuestions);
        assert.deepEqual(database.prepare('SELECT * FROM questions ORDER BY id').all(), firstLoad);

        const revisedQuestions = [
            { ...exampleQuestions[0], prompt: 'Updated prompt', legacy_field: 'ignored' },
            ...exampleQuestions.slice(1, -1),
            {
                id: 99,
                prompt: 'New question',
                options: ['A', 'B'],
                correct_option_index: 1,
                explanation: null
            }
        ];
        syncQuestionCatalog(database, revisedQuestions);

        const storedQuestions = database.prepare('SELECT * FROM questions ORDER BY id').all();
        assert.deepEqual(
            storedQuestions.map(question => question.id),
            [...exampleQuestions.slice(0, -1).map(question => question.id), 99]
        );
        assert.equal(storedQuestions[0].prompt, 'Updated prompt');
        assert.deepEqual(Object.keys(storedQuestions[0]).sort(), questionFields);
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM questions').get().count, 8);
    });
});
