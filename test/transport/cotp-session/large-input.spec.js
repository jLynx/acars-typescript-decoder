import { describe, expect, it } from 'vitest';
import { createCotpSession, createCotpReassembler, decodeCotp } from '@/framing';
import { data, establish, receive, connect } from './wire';
const event = (r) => r.events.at(-1);
const preferred = { parameters: [[0xf0, [2, 0]]] };
describe('bounded large COTP NSDUs', () => {
	it('rejects a configured input overflow in all three public APIs', () => {
		const wire = data(0, new Uint8Array(1000));
		expect(decodeCotp(wire, { maxNsduBytes: 1000 })).toBeUndefined();
		const s = createCotpSession({ maxNsduBytes: 1000 });
		expect(() => s.push(wire, receive())).toThrow('Invalid COTP session NSDU');
		const r = createCotpReassembler({ maxNsduBytes: 1000 });
		expect(() => r.push(wire, { link: 'x', receivedAt: 0 })).toThrow('Invalid COTP NSDU');
	});
	it.each([8193, 32768, 65535])('parses and assembles %i-byte packets with explicit local capacity', (size) => {
		const wire = data(0, new Uint8Array(size - 9).fill(7));
		expect(decodeCotp(wire)).toBeUndefined();
		expect(decodeCotp(wire, { maxNsduBytes: size }).integrity).toBe('verified');
		const s = createCotpSession({ maxNsduBytes: size });
		const offer = { parameters: [[0xf0, [255, 255, 255, 255]]] };
		establish(s, offer, offer);
		expect(s.push(wire, receive(1)).assemblies[0].payload).toHaveLength(size - 9);
		const r = createCotpReassembler({ maxNsduBytes: size });
		r.open({ link: 'x', destinationReference: 22, sourceReference: 11, format: 'normal' }, 0);
		expect(r.push(wire, { link: 'x', receivedAt: 1 }).assemblies[0].payload).toHaveLength(size - 9);
	});
	it.each([0, 1, 65536, 1.5, NaN, Infinity, -1])('rejects invalid configured input bound %s', (size) => {
		for (const f of [
			() => createCotpSession({ maxNsduBytes: size }),
			() => createCotpReassembler({ maxNsduBytes: size }),
			() => decodeCotp(data(), { maxNsduBytes: size }),
		])
			expect(f).toThrow('Invalid COTP NSDU input limit');
	});
	it('does not let local capacity bypass the negotiated packet size', () => {
		const s = createCotpSession({ maxNsduBytes: 65535 });
		expect(event(establish(s, preferred, preferred)).negotiation.tpduSize).toBe(65536);
		expect(s.push(data(0, new Uint8Array(65535 - 9)), receive(1)).assemblies[0].status).toBe('complete');
		const t = createCotpSession({ maxNsduBytes: 65535 });
		establish(t, { parameters: [[0xf0, [1, 0]]] }, { parameters: [[0xf0, [1, 0]]] });
		expect(event(t.push(data(0, new Uint8Array(32768 - 8)), receive(1))).status).toBe('failed');
		expect(t.push(data(), receive(2)).assemblies[0].status).toBe('complete');
	});
	it('rejects one byte above the configured bound before changing sequence or expiry', () => {
		const s = createCotpSession({ maxNsduBytes: 9000 });
		establish(s, preferred, preferred);
		expect(() => s.push(data(0, new Uint8Array(8992)), receive(1))).toThrow();
		expect(s.push(data(), receive(2)).assemblies[0].status).toBe('complete');
	});
	it('retains assembly limits and corruption rejection for large packets', () => {
		const s = createCotpSession({ maxNsduBytes: 65535, maxBytes: 9000 });
		establish(s, preferred, preferred);
		const corrupt = data(0, new Uint8Array(10000));
		corrupt[corrupt.length - 1] ^= 1;
		expect(event(s.push(corrupt, receive(1))).status).toBe('failed');
		expect(s.stats().bytes).toBe(0);
		expect(event(s.push(data(0, new Uint8Array(9001)), receive(2))).status).toBe('closed');
		expect(s.stats().bytes).toBe(0);
	});
	it('keeps the connect request 128-byte limit with large input capacity', () => {
		const s = createCotpSession({ maxNsduBytes: 65535 });
		expect(event(s.push(connect(0xe0, { parameters: [[0xc1, new Uint8Array(120)]] }), receive())).status).toBe(
			'failed',
		);
	});
});
