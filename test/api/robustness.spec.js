import { describe, expect, it } from 'vitest';
import { decode } from '@/index';

describe('bounded adversarial payloads', () => {
	it('preserves result shape and avoids throws across deterministic mutations', () => {
		let seed = 0x12345678;
		const next = () => {
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			return seed >>> 0;
		};
		const labels = ['H1', 'MA', 'A0', 'A6', '3L', '10', '2L', 'ZZ', 'SA'];
		for (let iteration = 0; iteration < 800; iteration++) {
			let text = '';
			for (let length = next() % 300; length; length--) text += String.fromCharCode(next() % 128);
			const result = decode({ label: labels[next() % labels.length], text, receivedAt: 1791576000000 });
			expect(['decoded', 'partial', 'unknown']).toContain(result.coverage);
			expect(result.title).toBeTypeOf('string');
			expect(result.fields.every((f) => typeof f.label === 'string' && typeof f.value === 'string')).toBe(true);
		}
	});
});
