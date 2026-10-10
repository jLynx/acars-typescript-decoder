import { describe, expect, it } from 'vitest';
import { createClnpCompressedReassembler } from '@/framing';

// Independent two linear checksum equations from RFC 994, not the parser's running sums.
function setup({ reference = [1, 44], priority = 3, source = 1, security = [0x80, 1], lifetime = 20 } = {}) {
	const options = [5, reference.length, ...reference, 0xcd, 1, priority, 0xc5, security.length, ...security];
	const length = 13 + options.length;
	const bytes = Uint8Array.from([0x81, length, 1, lifetime, 28, 0, length + 1, 0, 0, 1, 2, 1, source, ...options, 0]);
	const header = bytes.subarray(0, length);
	const sum = header.reduce((a, b) => a + b, 0);
	const weighted = header.reduce((a, b, i) => a + b * (i + 1), 0);
	const mod = (n) => ((n % 255) + 255) % 255 || 255;
	bytes[7] = mod(weighted - 9 * sum);
	bytes[8] = mod(-sum - bytes[7]);
	return bytes;
}
const reception = (receivedAt = 0, link = 'a', linkIntegrity = 'verified') => ({ receivedAt, link, linkIntegrity });
const compressed = (priority = 3) => Uint8Array.of(priority, 20, 0, 129, 44, 0);
describe('captured Mobile SNDCF local-reference context setup', () => {
	it('registers verified context, scopes reference by priority and preserves original setup', () => {
		const e = createClnpCompressedReassembler();
		const bytes = setup();
		expect(e.observe(bytes, reception())).toMatchObject({
			status: 'registered',
			context: { localReference: 300, priority: 3, version: 1 },
		});
		expect(e.observe(bytes, reception()).status).toBe('duplicate');
		expect(e.push(compressed(), reception()).context.source).toEqual(Uint8Array.of(1));
		expect(e.push(compressed(4), reception()).status).toBe('ignored');
		expect(e.push(compressed(), reception(0, 'b')).status).toBe('ignored');
		expect(e.observe(setup({ priority: 4, source: 5 }), reception()).status).toBe('registered');
		expect(e.push(compressed(4), reception()).context.source).toEqual(Uint8Array.of(5));
	});
	it('withholds expired, corrupt or unknown-integrity setup and invalid references', () => {
		const e = createClnpCompressedReassembler();
		for (const reference of [
			[128, 0],
			[1, 2, 3],
		])
			expect(e.observe(setup({ reference }), reception()).status).toBe('failed');
		expect(e.observe(setup({ lifetime: 0 }), reception()).status).toBe('failed');
		for (const state of ['failed', 'unverified'])
			expect(e.observe(setup(), reception(0, 'a', state)).status).toBe('failed');
		const bad = setup();
		bad[7] ^= 1;
		expect(e.observe(bad, reception()).status).toBe('failed');
		expect(e.stats().contexts).toBe(0);
	});
	it('replaces security/address changes, resets scope, and re-registers after expiry', () => {
		const e = createClnpCompressedReassembler({ retentionMs: 10 });
		e.observe(setup(), reception());
		expect(e.observe(setup({ security: [0x80, 2], source: 9 }), reception(1)).status).toBe('registered');
		expect(e.push(compressed(), reception(1)).context.source[0]).toBe(9);
		expect(e.observe(setup({ security: [0x80, 2], source: 9 }), reception(11)).status).toBe('registered');
		e.reset('a');
		expect(e.stats().contexts).toBe(0);
		expect(e.observe(setup(), reception(10)).status).toBe('failed');
	});
});
