import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { literal, unresolved } from '../../scripts/upstream/literals.mjs';

const parse = (text) =>
	ts.createSourceFile('fixture.ts', `const value = ${text};`, ts.ScriptTarget.Latest, true).statements[0]
		.declarationList.declarations[0].initializer;
describe('static upstream fixture extraction', () => {
	it('reads literals, safe arithmetic, references and substring without evaluating code', () => {
		expect(literal(parse('{label: "H1", text: "HELLO".substring(1), values: [1 + 2, -4]}'))).toEqual({
			label: 'H1',
			text: 'ELLO',
			values: [3, -4],
		});
		expect(literal(parse('message.text'), { message: { text: 'DATA' } })).toBe('DATA');
	});
	it('refuses executable expressions, getters, spreads and prototype-mutating keys', () => {
		for (const code of [
			'process.exit()',
			'(() => { throw Error("run"); })()',
			'{ get x(){ return 1; } }',
			'{__proto__: {polluted:true}}',
			'{constructor: 1}',
			'{...message}',
			'`value${process.env.TOKEN}`',
		])
			expect(literal(parse(code))).toBe(unresolved);
		expect({}.polluted).toBeUndefined();
	});
});
