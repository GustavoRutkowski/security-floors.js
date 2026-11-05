export function validateQuestionCatalog(questionList) {
    if (!Array.isArray(questionList)) {
        throw new TypeError('Question catalog must be an array');
    }

    const questionIds = new Set();
    for (const [index, question] of questionList.entries()) {
        if (!question || typeof question !== 'object' || Array.isArray(question)) {
            throw new TypeError(`Question at index ${index} must be an object`);
        }
        if (!Number.isSafeInteger(question.id)) {
            throw new TypeError(`Question at index ${index} must have an integer id`);
        }
        if (questionIds.has(question.id)) {
            throw new Error(`Duplicate question id: ${question.id}`);
        }
        questionIds.add(question.id);

        if (typeof question.prompt !== 'string' || question.prompt.trim() === '') {
            throw new TypeError(`Question ${question.id} must have a prompt`);
        }
        if (
            !Array.isArray(question.options) ||
            question.options.length < 2 ||
            !question.options.every(option => typeof option === 'string' && option.trim() !== '')
        ) {
            throw new TypeError(`Question ${question.id} must have at least two non-empty options`);
        }
        if (
            !Number.isInteger(question.correct_option_index) ||
            question.correct_option_index < 0 ||
            question.correct_option_index >= question.options.length
        ) {
            throw new RangeError(`Question ${question.id} has an invalid correct_option_index`);
        }
    }
}

export function syncQuestionCatalog(database, questionList) {
    validateQuestionCatalog(questionList);

    const syncQuestions = database.transaction(questions => {
        const questionIds = questions.map(question => question.id);
        if (questionIds.length === 0) {
            database.exec('DELETE FROM questions');
        } else {
            const placeholders = questionIds.map(() => '?').join(', ');
            database
                .prepare(`DELETE FROM questions WHERE id NOT IN (${placeholders})`)
                .run(...questionIds);
        }

        const upsertQuestion = database.prepare(`
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

        for (const question of questions) {
            upsertQuestion.run({
                id: question.id,
                prompt: question.prompt,
                options: JSON.stringify(question.options),
                correct_option_index: question.correct_option_index,
                explanation: question.explanation ?? null
            });
        }
    });

    syncQuestions(questionList);
}
