import { describe, expect, it } from 'vitest';
import { decode } from '@/index';
import { encode85 } from '../miam-fixtures.js';

function wire(version, type, extra = {}) {
	const header = Uint8Array.from([(type << 4) | version, 0, 0, 16, ...Buffer.from('.ZK-NZE'), 1, 3, 0, 0, 0]);
	for (const [offset, value] of Object.entries(extra)) header[Number(offset)] = value;
	const encoded = encode85(header);
	return `T.0${encoded.text}|`;
}

describe('libacars common MIAM negotiation fields', () => {
	it.each([1, 2])('decodes ALO/ALR version %s using the common sixteen-byte layout', (version) => {
		for (const type of [2, 3]) {
			const result = decode({ label: 'MA', text: wire(version, type) });
			expect(result.coverage).toBe('decoded');
			expect(result.title).toContain(type === 2 ? 'ALO' : 'ALR');
			expect(result.fields).toContainEqual({ label: 'Supported networks', value: 'ACARS, IP middleware' });
		}
	});
	it('preserves unknown capability bits as partial and rejects bad lengths', () => {
		expect(decode({ label: 'MA', text: wire(1, 2, { 11: 3 }) }).coverage).toBe('partial');
		expect(decode({ label: 'MA', text: wire(1, 2, { 3: 17 }) }).coverage).toBe('unknown');
		expect(decode({ label: 'MA', text: wire(1, 2) + 'unexpected' }).coverage).toBe('unknown');
	});
});
