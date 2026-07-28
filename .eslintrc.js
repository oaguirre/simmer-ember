module.exports = {
	env: {
		es2021: true,
		node: true,
	},
	extends: ['standard-with-typescript', 'plugin:n/recommended', 'plugin:import/recommended', 'plugin:promise/recommended'],
	overrides: [
		{
			files: ['*.ts'],
		},
	],
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
		project: './tsconfig.json',
	},
	rules: {
		'@typescript-eslint/prefer-nullish-coalescing': 'off',
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],		
		'@typescript-eslint/explicit-function-return-type': 'off',
		'@typescript-eslint/no-explicit-any': 'off',
		'@typescript-eslint/no-misused-promises': 'off',
		'@typescript-eslint/no-unsafe-argument': 'off',
		'@typescript-eslint/no-unused-vars': 'off',
		'@typescript-eslint/no-unsafe-assignment': 'off',
		'@typescript-eslint/no-unsafe-call': 'off',
		'@typescript-eslint/no-unsafe-member-access': 'off',
		'@typescript-eslint/no-unsafe-return': 'off',
		'@typescript-eslint/strict-boolean-expressions': 'off',
		'@typescript-eslint/no-throw-literal': 'off',
		'@typescript-eslint/consistent-type-imports': 'error',
		'@typescript-eslint/naming-convention': 'off',
		'import/no-unresolved': 'off',
		'import/no-named-as-default': 'off',
		'import/no-named-as-default-member': 'off',
		'n/no-missing-import': 'off',
		'n/no-process-exit': 'off',
		'node/no-unused-vars': 'off'
	},	
}
