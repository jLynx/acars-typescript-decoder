import { describe, expect, it } from 'vitest';
import { decodeAtnUlcs } from '@/index';
import { decodeAtnUlcs as formatsUlcs } from '@/formats';

// Independent X.691 bit-string construction, no production bit-reader/CRC helpers.
const binary = (value, length) => BigInt(value).toString(2).padStart(length, '0');
const bytes = (bits) =>
	Uint8Array.from(bits.padEnd(Math.ceil(bits.length / 8) * 8, '0').match(/.{8}/g) ?? [], (octet) => parseInt(octet, 2));
const length = (value) => (value < 128 ? binary(value, 8) : binary(0x8000 | value, 16));
const octets = (values) => values.map((value) => binary(value, 8)).join('');
const pdv = (context, payload, encoding = 2, syntax = '', extended = false) =>
	`${syntax ? '1' + length(syntax.length / 8) + syntax : '0'}${extended ? '1' + length(2) + binary(context, 16) : '0' + binary(context - 1, 7)}${binary(encoding, 2)}${length(encoding === 2 ? payload.length : payload.length / 8)}${payload}`;
const fed = (...values) => bytes(`${values.length === 1 ? '0' : '1' + length(values.length)}${values.join('')}`);

describe('explicit ATN ULCS presentation and short-session envelopes', () => {
	it.each([decodeAtnUlcs, formatsUlcs])('reads independent ACSE and user-context wire prefixes', (reader) => {
		for (const [identifier, context, prefix] of [
			[1, 'acse-apdu', 0x20],
			[3, 'user-ase-apdu', 0xa0],
		]) {
			const wire = fed(pdv(identifier, '10101'));
			expect(wire[0]).toBe(0);
			expect(wire[1] & 0xf0).toBe(prefix);
			const result = reader(wire, 'data');
			expect(result.envelopeComplete).toBe(true);
			expect(result.values[0]).toEqual({
				contextIdentifier: identifier,
				context,
				encoding: 'arbitrary',
				payload: Uint8Array.of(0xa8),
				bitLength: 5,
				profileSupported: true,
			});
			expect(result.coverage).toBe('partial');
			expect(result.integrity).toBe('unverified');
		}
	});
	it.each([
		[2, 'reserved'],
		[127, 'unknown'],
		[128, 'unknown'],
	])('retains context %i without selecting an application', (id, context) => {
		const result = decodeAtnUlcs(fed(pdv(id, '1', 2, '', id > 127)), 'data');
		expect(result.values[0]).toMatchObject({ contextIdentifier: id, context, bitLength: 1, profileSupported: false });
		expect(result.notes.join(' ')).toContain('extended ULCS profile');
	});
	it.each([0, 1])('preserves excluded encoding %i', (encoding) => {
		const result = decodeAtnUlcs(fed(pdv(3, octets([0x12, 0x34]), encoding)), 'data');
		expect(result.values[0].payload).toEqual(Uint8Array.of(0x12, 0x34));
		expect(result.values[0].bitLength).toBe(16);
		expect(result.values[0].profileSupported).toBe(false);
	});
	it('preserves a transfer-syntax OID with multibyte arcs', () => {
		const result = decodeAtnUlcs(fed(pdv(3, '101', 2, octets([0x88, 0x37, 3]))), 'data');
		expect(result.values[0].transferSyntax).toBe('2.999.3');
		expect(result.values[0].profileSupported).toBe(false);
	});
	it('reads bounded extended presentation lists', () => {
		const result = decodeAtnUlcs(fed(pdv(1, '1'), pdv(3, '101')), 'data');
		expect(result.values.map((value) => value.contextIdentifier)).toEqual([1, 3]);
		expect(result.envelopeComplete).toBe(true);
	});
	it('reads a two-octet bit-length determinant without a false extra header', () => {
		const result = decodeAtnUlcs(fed(pdv(3, '10'.repeat(100))), 'data');
		expect(result.values[0].bitLength).toBe(200);
		expect(result.values[0].payload).toEqual(new Uint8Array(25).fill(0xaa));
	});
	it('reads a fragmented bit string with its final zero-length determinant', () => {
		const header = `0${pdv(3, '').slice(0, -8)}`;
		const result = decodeAtnUlcs(bytes(header + binary(0xc1, 8) + '10'.repeat(8192) + binary(0, 8)), 'data');
		expect(result.values[0].bitLength).toBe(16384);
		expect(result.values[0].payload.length).toBe(2048);
		expect(result.envelopeComplete).toBe(true);
	});
	it('retains nonzero padding and trailing bytes as incomplete evidence', () => {
		const wire = fed(pdv(3, '101'));
		wire[wire.length - 1] |= 1;
		expect(decodeAtnUlcs(wire, 'data').envelopeComplete).toBe(false);
		expect(decodeAtnUlcs(Uint8Array.from([...fed(pdv(3, '101')), 0]), 'data').envelopeComplete).toBe(false);
	});
	it.each([0, 1, 2])('rejects truncated %i-byte envelopes', (count) => {
		expect(() => decodeAtnUlcs(fed(pdv(3, '10'.repeat(10))).slice(0, count), 'data')).toThrow();
	});
	it.each([
		'0' + '0' + '0' + binary(127, 7) + binary(2, 2) + length(0),
		'0' + '0' + '0' + binary(2, 7) + binary(3, 2),
		'1' + length(17),
		'1' + length(1),
		'0' + '1' + length(1) + binary(0x80, 8),
	])('rejects invalid constraint/choice/list/OID encoding', (bits) =>
		expect(() => decodeAtnUlcs(bytes(bits), 'data')).toThrow(),
	);
	it.each([
		[0xe8, 'SCN', 'CP'],
		[0xf8, 'SCNC', 'CP'],
		[0xf0, 'SAC', 'CPA'],
		[0xd8, 'SACC', 'CPA'],
	])('reads short connection type %s', (octet, session, presentation) => {
		const result = decodeAtnUlcs(Uint8Array.of(octet, 2, 0xaa, 0xbb), 'connection');
		expect(result.session).toEqual({ type: session, raw: octet });
		expect(result.presentation).toEqual({ type: presentation, raw: 2 });
		expect(result.application).toEqual(Uint8Array.of(0xaa, 0xbb));
		expect(result.envelopeComplete).toBe(true);
	});
	it.each(Array.from({ length: 8 }, (_, code) => code))('reads presentation rejection reason %i', (code) => {
		const result = decodeAtnUlcs(Uint8Array.of(0xe7, (code << 4) | 2), 'connection');
		expect(result.session).toEqual({
			type: 'SRF',
			raw: 0xe7,
			parameterIndication: true,
			transportReleased: true,
			persistent: true,
		});
		expect(result.presentation.error.code).toBe(code);
		expect(result.presentation.error.description).toBeTruthy();
		expect(result.envelopeComplete).toBe(true);
	});
	it('does not assign unindicated refusal parameter bits', () => {
		const result = decodeAtnUlcs(Uint8Array.of(0xa3, 2), 'connection');
		expect(result.session.parameterIndication).toBe(false);
		expect(result.session.persistent).toBeUndefined();
		expect(result.envelopeComplete).toBe(false);
	});
	it.each([
		[0xe9, 2],
		[0xe8, 3],
		[0xe0, 0x82],
	])('retains unsupported flags in %s/%s', (session, presentation) => {
		const result = decodeAtnUlcs(Uint8Array.of(session, presentation), 'connection');
		expect(result.envelopeComplete).toBe(false);
		expect(result.raw).toEqual(Uint8Array.of(session, presentation));
	});
	it('enforces mode and byte bounds and copies retained data', () => {
		expect(() => decodeAtnUlcs(Uint8Array.of(0), 'connection')).toThrow();
		expect(() => decodeAtnUlcs(Uint8Array.of(0, 2), 'connection')).toThrow();
		expect(() => decodeAtnUlcs(new Uint8Array(8193), 'data')).toThrow();
		expect(() => decodeAtnUlcs(fed(pdv(3, '1')), 'guess')).toThrow();
		const input = Uint8Array.of(0xe8, 2, 10);
		const result = decodeAtnUlcs(input, 'connection');
		input.fill(0);
		expect(result.raw).toEqual(Uint8Array.of(0xe8, 2, 10));
		expect(result.application).toEqual(Uint8Array.of(10));
	});
});
