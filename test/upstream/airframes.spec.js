import { describe, expect, it } from 'vitest';
import { MessageDecoder } from '@airframes/acars-decoder';
import fixtures from './airframes.json';

// Execute only the installed, pinned dependency. Downloaded upstream tests are syntax data.
const decoder = new MessageDecoder();
const valueAt = (result, path) => path.reduce((value, key) => value?.[key], result);

describe('ported Airframes upstream assertions', () => {
	it.each(fixtures.cases.filter((fixture) => fixture.plugin))('$file: $name', (fixture) => {
		const plugin = decoder.plugins.find((entry) => entry.name === fixture.plugin);
		expect(plugin, `Missing installed plugin ${fixture.plugin}`).toBeDefined();
		const input = structuredClone(fixture.input);
		const result = plugin.decode(input);
		for (const assertion of fixture.assertions) {
			const values = assertion.values.map((value) => (value?.$undefined ? undefined : value));
			const actual = valueAt(result, assertion.path);
			const check = expect(actual, `${fixture.file} ${assertion.path.join('.')}`);
			switch (assertion.matcher) {
				case 'toBe':
					check.toBe(values[0]);
					break;
				case 'toEqual':
					check.toEqual(values[0]);
					break;
				case 'toContain':
					check.toContain(values[0]);
					break;
				case 'toBeCloseTo':
					check.toBeCloseTo(...values);
					break;
				case 'toBeUndefined':
					check.toBeUndefined();
					break;
				case 'toBeDefined':
					check.toBeDefined();
					break;
				case 'toStrictEqual':
					check.toStrictEqual(values[0]);
					break;
				case 'toHaveLength':
					check.toHaveLength(values[0]);
					break;
				case 'toBeFalsy':
					check.toBeFalsy();
					break;
				default:
					throw new Error(`Unsupported assertion ${assertion.matcher}`);
			}
		}
		expect(input).toEqual(fixture.input);
	});
});
