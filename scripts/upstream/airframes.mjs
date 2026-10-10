import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { MessageDecoder } from '@airframes/acars-decoder';
import { accessPath, literal, unresolved } from './literals.mjs';
import { format, resolveConfig } from 'prettier';

const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/upstream/airframes.mjs <pinned Airframes checkout>');
const manifest = JSON.parse(await fs.readFile('docs/upstreams.json', 'utf8'));
const source = manifest.sources.find((item) => item.id === 'airframes');
const cases = [],
	inventory = [];
const directory = path.join(root, 'lib/plugins');
const plugins = new MessageDecoder().plugins;

function walk(node, visit) {
	visit(node);
	ts.forEachChild(node, (child) => walk(child, visit));
}

function seed(node, variables) {
	for (const statement of node.statements ?? []) {
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name)) continue;
			const value = literal(declaration.initializer, variables);
			if (value !== unresolved) variables[declaration.name.text] = value;
		}
	}
}

function extract(node, file, inherited, pluginName) {
	if (!ts.isCallExpression(node) || !['test', 'it'].includes(node.expression.getText())) return;
	const name = literal(node.arguments[0]);
	const callback = node.arguments[1];
	if (!callback?.body || typeof name !== 'string') return;
	const variables = structuredClone(inherited);
	seed(callback.body, variables);
	let input, resultName;
	const assertions = [],
		skipped = [];
	walk(callback.body, (child) => {
		if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
			const route = accessPath(child.left);
			const value = literal(child.right, variables);
			if (
				route?.length === 2 &&
				Object.hasOwn(variables, route[0]) &&
				variables[route[0]] &&
				!['__proto__', 'constructor', 'prototype'].includes(route[1]) &&
				value !== unresolved
			)
				variables[route[0]][route[1]] = value;
		}
		if (
			ts.isVariableDeclaration(child) &&
			child.initializer &&
			ts.isCallExpression(child.initializer) &&
			child.initializer.expression.getText().endsWith('.decode')
		) {
			input = literal(child.initializer.arguments[0], variables);
			resultName = child.name.getText();
		}
		if (!resultName || !ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)) return;
		const matcher = child.expression.name.text;
		const expectCall = child.expression.expression;
		if (!ts.isCallExpression(expectCall) || expectCall.expression.getText() !== 'expect') return;
		const route = accessPath(expectCall.arguments[0]);
		if (route?.[0] !== resultName || route[1] === 'message') return;
		const values = child.arguments.map((argument) => literal(argument, variables));
		if (
			![
				'toBe',
				'toEqual',
				'toStrictEqual',
				'toContain',
				'toHaveLength',
				'toBeCloseTo',
				'toBeUndefined',
				'toBeDefined',
				'toBeFalsy',
			].includes(matcher) ||
			values.includes(unresolved)
		) {
			skipped.push(child.getText());
			return;
		}
		assertions.push({ path: route.slice(1), matcher, values });
	});
	if (!resultName) return;
	const entry = { file, name, assertions: assertions.length, skipped };
	inventory.push(entry);
	if (input === unresolved || !input || typeof input.label !== 'string' || typeof input.text !== 'string') {
		entry.reason = 'Input cannot be statically resolved';
		return;
	}
	if (assertions.length) cases.push({ file, name, plugin: pluginName, input, assertions });
}

for (const file of (await fs.readdir(directory)).filter((name) => name.endsWith('.test.ts')).sort()) {
	const text = await fs.readFile(path.join(directory, file), 'utf8');
	const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const variables = {};
	let pluginName = null;
	walk(ast, (node) => {
		if (ts.isCallExpression(node) && node.expression.getText() === 'describe')
			seed(node.arguments[1]?.body ?? {}, variables);
		if (ts.isCallExpression(node) && node.expression.getText() === 'expect(plugin.name).toBe')
			pluginName = literal(node.arguments[0]);
		if (ts.isBinaryExpression(node) && node.left.getText() === 'plugin' && ts.isNewExpression(node.right)) {
			pluginName ??=
				plugins.find((plugin) => plugin.constructor.name === node.right.expression.getText())?.name ?? null;
		}
	});
	walk(ast, (node) => extract(node, file, variables, pluginName));
	inventory.push({ file, sha256: crypto.createHash('sha256').update(text).digest('hex') });
}
await fs.mkdir('test/upstream', { recursive: true });
await fs.copyFile(path.join(root, 'License.md'), 'test/upstream/airframes.license.txt');
await fs.writeFile(
	'test/upstream/airframes.json',
	await format(JSON.stringify({ source, inventory, cases }), {
		...(await resolveConfig('test/upstream/airframes.json')),
		parser: 'json',
	}),
);
console.log(
	`Imported ${cases.length} cases and ${cases.reduce((sum, item) => sum + item.assertions.length, 0)} assertions; unresolved cases remain in inventory.`,
);
