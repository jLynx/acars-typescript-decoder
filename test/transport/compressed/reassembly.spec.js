import { describe, expect, it } from 'vitest';
import { createClnpCompressedReassembler, decodeClnpCompressed } from '@/framing';
import { data } from '../cotp-session/wire';
const context = (link = 'a', localReference = 300) => ({
	link,
	localReference,
	source: Uint8Array.of(1),
	destination: Uint8Array.of(2),
});
const packet = (
	body,
	offset = 0,
	{ total = body.length, more = false, reference = 300, id = 42, lifetime = 10, type = more ? 7 : 6, flags = 0 } = {},
) =>
	Uint8Array.from([
		type * 16 + 3,
		lifetime,
		flags,
		128 + (reference >>> 8),
		reference & 255,
		id >>> 8,
		id & 255,
		offset >>> 8,
		offset & 255,
		total >>> 8,
		total & 255,
		...body,
	]);
const push = (e, bytes, receivedAt = 0, link = 'a', linkIntegrity = 'verified') =>
	e.push(bytes, { link, receivedAt, linkIntegrity });
describe('compressed CLNP explicit context and bounded offset reassembly', () => {
	it('joins reversed derived fragments and verifies complete inner COTP', () => {
		const e = createClnpCompressedReassembler(),
			body = data();
		e.open(context(), 0);
		expect(push(e, packet(body.slice(5), 5, { total: body.length })).status).toBe('pending');
		const result = push(e, packet(body.slice(0, 5), 0, { total: body.length, more: true }));
		expect(result).toMatchObject({
			status: 'complete',
			fragments: 2,
			cotp: { integrity: 'verified' },
			context: { localReference: 300 },
		});
		expect(result.payload).toEqual(body);
		expect(push(e, packet(body.slice(0, 5), 0, { total: body.length, more: true })).status).toBe('duplicate');
	});
	it('withholds inner results for absent context and unverified/failed link envelopes', () => {
		const e = createClnpCompressedReassembler();
		expect(push(e, packet(data())).status).toBe('ignored');
		e.open(context(), 0);
		for (const integrity of ['failed', 'unverified'])
			expect(push(e, packet(data()), 0, 'a', integrity).status).toBe('failed');
		expect(e.stats().bytes).toBe(0);
	});
	it('isolates local references and directions and replaces/reset contexts without sharing bytes', () => {
		const e = createClnpCompressedReassembler();
		e.open(context('a'), 0);
		e.open(context('b'), 0);
		e.open(context('a', 301), 0);
		push(e, packet([1, 2], 0, { total: 4, more: true }));
		expect(push(e, packet([3, 4], 2, { total: 4 }), 0, 'b').status).toBe('pending');
		expect(push(e, packet([3, 4], 2, { total: 4, reference: 301 })).status).toBe('pending');
		e.open(context('a'), 0);
		expect(push(e, packet([3, 4], 2, { total: 4 })).status).toBe('pending');
		e.reset('a');
		expect(e.stats().contexts).toBe(1);
		expect(e.stats().assemblies).toBe(1);
	});
	it('quarantines overlap, flags, family and total conflicts without losing raw packet bytes', () => {
		for (const second of [
			packet([9, 4], 1, { total: 4 }),
			packet([3, 4], 2, { total: 4, flags: 1 }),
			packet([3, 4], 2, { total: 4, type: 9 }),
			packet([3, 4], 2, { total: 5, more: true }),
		]) {
			const e = createClnpCompressedReassembler();
			e.open(context(), 0);
			push(e, packet([1, 2], 0, { total: 4, more: true }));
			const result = push(e, second);
			expect(result.status).toBe('failed');
			expect(result.packet.raw).toEqual(second);
			expect(push(e, packet([3, 4], 2, { total: 4 })).status).toBe('failed');
		}
	});
	it('accepts identical overlap, requires final boundary and rejects malformed headers', () => {
		const e = createClnpCompressedReassembler();
		e.open(context(), 0);
		push(e, packet([1, 2, 3], 0, { total: 4, more: true }));
		expect(push(e, packet([3, 4], 2, { total: 4 })).payload).toEqual(Uint8Array.of(1, 2, 3, 4));
		for (const bytes of [packet([], 0, { total: 1 }), packet([1, 2], 2, { total: 3 }), Uint8Array.of(0x60, 1, 0, 128)])
			expect(decodeClnpCompressed(bytes)).toBeUndefined();
		const other = createClnpCompressedReassembler();
		other.open(context(), 0);
		expect(push(other, packet([1], 0, { total: 2 })).status).toBe('failed');
	});
	it('bounds contexts/messages/bytes/fragments, expires lifetimes, rejects backwards time and clones mappings', () => {
		const e = createClnpCompressedReassembler({ maxAssemblies: 1, maxBytes: 4, maxFragments: 1, retentionMs: 10 });
		const c = context();
		e.open(c, 0);
		c.source[0] = 9;
		expect(push(e, packet([1], 0, { total: 4, more: true })).context.source[0]).toBe(1);
		expect(push(e, packet([2, 3, 4], 1, { total: 4 })).status).toBe('failed');
		expect(push(e, packet([1], 0, { total: 5 })).status).toBe('failed');
		expect(push(e, packet([1]), 10).discarded.length).toBeGreaterThan(0);
		expect(push(e, packet([1]), 9).status).toBe('failed');
		e.reset();
		expect(e.stats().contexts).toBe(0);
		expect(() => createClnpCompressedReassembler({ maxAssemblies: 0 })).toThrow();
	});
});
