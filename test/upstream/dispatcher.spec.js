import { describe, expect, it } from 'vitest';
import { MessageDecoder } from '@airframes/acars-decoder';
import { decode } from '@/index';
import { compareFields } from '../../scripts/upstream/fields.mjs';
import fixtures from './airframes.json';

const upstream = new MessageDecoder();
describe('public dispatcher retains upstream display semantics', () => {
	it.each(fixtures.cases.filter((fixture) => fixture.plugin))('$file: $name', (fixture) => {
		const reference = upstream.plugins
			.find((plugin) => plugin.name === fixture.plugin)
			.decode(structuredClone(fixture.input));
		const actual = decode({ ...fixture.input, receivedAt: 1791576000000, direction: 'downlink' });
		const expected = (reference.formatted?.items ?? []).filter(
			(item) =>
				item.value && item.value !== 'Unknown' && !/unknown/i.test(item.type) && !/NaN|Infinity/.test(item.value),
		);
		const comparisons = compareFields(expected, actual, fixture.input);
		expect(comparisons.filter((field) => field.classification === 'unresolved')).toEqual([]);
	});
});
