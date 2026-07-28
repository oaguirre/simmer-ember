declare module 'node:process' {
	const process: {
		env: Record<string, string | undefined>
		argv: string[]
		exit(code?: number): never
	}

	export default process
}

declare module 'node:buffer' {
	export class Buffer {
		static alloc(size: number): Buffer
		static from(data: string | ArrayBuffer | Uint8Array, encoding?: string): Buffer
		static isBuffer(value: unknown): value is Buffer
		static concat(list: readonly Uint8Array[], totalLength?: number): Buffer
		toString(encoding?: string): string
	}
}

declare module 'node:crypto' {
	export function createHash(algorithm: string): {
		update(data: string | ArrayBuffer | Uint8Array): any
		digest(encoding: 'hex' | 'base64' | 'latin1'): string
	}
}

declare module 'node:fs' {
	const fs: any

	export default fs
}
