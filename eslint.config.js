import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
    {
        ignores: ['node_modules/**', '.env*', 'db/*.sqlite*', '**/dist/**']
    },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
        },
        rules: {
            'eqeqeq': ['warn', 'always'],
            'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
            'no-implicit-coercion': ['warn', { boolean: false, number: true, string: true }],
            'no-eval': 'error',
            'no-unsafe-optional-chaining': 'warn',
            'no-param-reassign': 'warn',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'prefer-const': 'warn',
            'prefer-template': 'warn',
            'no-var': 'error',
            'object-shorthand': 'warn'
        }
    },
    {
        files: ['web/**/*.js'],
        languageOptions: {
            globals: globals.browser
        }
    },
    {
        files: ['db/**/*.js', 'ws/**/*.js', '*.config.js'],
        languageOptions: {
            globals: globals.node
        }
    },
    prettier
];
