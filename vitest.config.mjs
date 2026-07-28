import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		restoreMocks: true,
		include: ['src/**/*.test.ts'],
		exclude: ['dist/**'],
		coverage: { provider: 'v8', reporter: ['text', 'json', 'html'] },
	},
})
