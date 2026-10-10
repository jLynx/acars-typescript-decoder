import { describe, expect, it } from 'vitest';
import { decode } from '@/index';
import fixtures from './airframes.json';

describe('upstream payloads through public dispatch', () => {
	it.each(fixtures.cases.filter((fixture) => /^(?:M58AEY0801|F37AKL0767)/.test(fixture.input.text)))(
		'$name preserves the flight code supplied before the application payload',
		(fixture) => {
			const result = decode(fixture.input);
			expect(result.fields).toContainEqual({ label: 'Flight Number', value: fixture.input.text.slice(4, 10) });
		},
	);
	it.each(
		fixtures.cases.filter(
			(fixture) =>
				fixture.file === 'Label_MA.test.ts' && ['decodes MIAM message', 'decodes twice'].includes(fixture.name),
		),
	)('$name: verifies MIAM and dispatches the addressed application', (fixture) => {
		const result = decode(fixture.input);
		expect(result.transfer.integrity).toBe('verified');
		expect(result.embedded.coverage).not.toBe('unknown');
		expect(result.transfer.text).toBeTypeOf('string');
		if (fixture.name === 'decodes MIAM message')
			expect(result.embedded.fields).toEqual(
				expect.arrayContaining([
					{ label: 'Aircraft type', value: 'A350' },
					{ label: 'Reported registration', value: 'F-HREV' },
					{ label: 'Departure', value: 'KSFO' },
					{ label: 'Destination', value: 'LFPO' },
				]),
			);
	});
	it.each(fixtures.cases.filter((fixture) => ['Label_H1_FLR.test.ts', 'Label_H1_WRN.test.ts'].includes(fixture.file)))(
		'$file: $name preserves upstream warning/fault text including spaces',
		(fixture) => {
			const expected = fixture.assertions.filter(
				(assertion) =>
					assertion.path[0] === 'formatted' &&
					assertion.path.at(-1) === 'value' &&
					assertion.values[0]?.endsWith?.(' '),
			);
			const result = decode(fixture.input);
			for (const assertion of expected)
				expect(result.fields.some((field) => field.value === assertion.values[0])).toBe(true);
		},
	);
});
