import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { syncQuestionCatalog } from './questions.js';

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
syncQuestionCatalog(db, questions);

export default db;
