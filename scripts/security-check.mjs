import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const getTrackedFiles = () => {
	const output = execSync('git ls-files -z', { encoding: 'utf8' })
	return output.split('\0').filter(Boolean)
}

const shouldSkipFile = filePath => {
	if (filePath.startsWith('dist/')) return true
	if (filePath.startsWith('node_modules/')) return true
	if (filePath.startsWith('coverage/')) return true
	if (filePath.startsWith('.git/')) return true
	if (filePath.startsWith('src/test/')) return true
	if (filePath.endsWith('.test.ts')) return true
	if (filePath.endsWith('.test.js')) return true
	if (filePath.endsWith('.md')) return true
	if (filePath === 'scripts/security-check.mjs') return true
	if (filePath === '.env' || filePath.startsWith('.env.')) return true
	if (filePath === '.development.env' || filePath === '.production.env') return true
	if (filePath.endsWith('.env.local') || filePath.endsWith('.env.example')) return true
	if (filePath.includes('/.env.')) return true
	return false
}

const checks = [
	{
		name: 'AWS access key',
		regex: /\bAKIA[0-9A-Z]{16}\b/g,
	},
	{
		name: 'OpenAI-style API key',
		regex: /\bsk-(?:live|proj)-[A-Za-z0-9_-]{20,}\b/g,
	},
	{
		name: 'Private key block',
		regex: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g,
	},
	{
		name: 'Likely hardcoded secret assignment',
		regex: /\b(?:password|secret|token|api[_-]?key|jwt[_-]?secret)\b\s*[:=]\s*['"][^'"\n]{8,}['"]/gi,
	},
]

const cspCheck = {
	name: 'Unsafe CSP directive',
	regex: /(?:content-security-policy|csp)[^\n]*(?:unsafe-inline|unsafe-eval)|['"]unsafe-(?:inline|eval)['"]/gi,
}

const findings = []

for (const filePath of getTrackedFiles()) {
	if (shouldSkipFile(filePath)) continue

	let content = ''
	try {
		content = readFileSync(filePath, 'utf8')
	} catch {
		continue
	}

	const lines = content.split(/\r?\n/)
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (!line || line.trim().startsWith('//')) continue

		for (const check of checks) {
			if (check.regex.test(line)) {
				findings.push(`${filePath}:${i + 1} ${check.name}`)
			}
			check.regex.lastIndex = 0
		}

		if (cspCheck.regex.test(line)) {
			findings.push(`${filePath}:${i + 1} ${cspCheck.name}`)
		}
		cspCheck.regex.lastIndex = 0
	}
}

if (findings.length > 0) {
	console.error('Security checks failed:')
	for (const finding of findings) {
		console.error(`- ${finding}`)
	}
	process.exit(1)
}

console.log('Security checks passed')
