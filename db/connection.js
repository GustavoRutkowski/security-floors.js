import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const configuredPath =
    process.env.DB_PATH ?? fileURLToPath(new URL('./game.sqlite', import.meta.url));
const databasePath = configuredPath === ':memory:' ? configuredPath : resolve(configuredPath);

if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
}

export const db = new Database(databasePath);

db.pragma('foreign_keys = ON');
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'));

const syncQuestions = db.transaction(questionList => {
    const questionIds = questionList.map(question => question.id);
    if (questionIds.length === 0) {
        db.exec('DELETE FROM questions');
    } else {
        const placeholders = questionIds.map(() => '?').join(', ');
        db.prepare(`DELETE FROM questions WHERE id NOT IN (${placeholders})`).run(...questionIds);
    }

    const insertQuestion = db.prepare(`
        INSERT INTO questions (
            id,
            prompt,
            options,
            correct_option_index,
            explanation
        ) VALUES (
            @id,
            @prompt,
            @options,
            @correct_option_index,
            @explanation
        )
        ON CONFLICT(id) DO UPDATE SET
            prompt = excluded.prompt,
            options = excluded.options,
            correct_option_index = excluded.correct_option_index,
            explanation = excluded.explanation
    `);

    for (const question of questionList) {
        insertQuestion.run({
            id: question.id,
            prompt: question.prompt,
            options: JSON.stringify(question.options),
            correct_option_index: question.correct_option_index,
            explanation: question.explanation ?? null
        });
    }
});

syncQuestions(questions);

export default db;
