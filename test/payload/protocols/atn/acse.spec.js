import { describe, expect, it } from 'vitest';
import { decodeAtnAcse, decodeAtnUlcs } from '@/index';
import { decodeAtnAcse as formatsAcse } from '@/formats';

// Independently encoded Doc9705 Ed2 profile, not generated from parser descriptors.
const int = (value, width) => BigInt(value).toString(2).padStart(width, '0');
const bytes = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g) ?? [], (v) => parseInt(v, 2));
const octets = (values) => values.map((v) => int(v, 8)).join('');
const oid = int(2, 8) + octets([42, 3]);
const integer = (value) => int(1, 8) + int(value & 255, 8);
const flags = (count, indices) => Array.from({ length: count }, (_, i) => (indices.includes(i) ? '1' : '0')).join('');
const external = (bits = '10101') => '010' + integer(3) + '10' + int(bits.length, 8) + bits;
const info = '0' + external();
const aarq = (indices = [], fields = '', ext = '') =>
	'0000' + (ext ? '1' : '0') + flags(15, indices) + oid + fields + ext;
const aare = (result = 0, provider = 0, diagnostic = 0) =>
	'0001' +
	'0' +
	flags(11, []) +
	oid +
	'0' +
	int(result, 2) +
	String(provider) +
	'0' +
	int(diagnostic, provider ? 2 : 4);
const release = (choice, reason, information = '') =>
	'0' +
	int(choice, 3) +
	'0' +
	(reason === undefined ? '0' : '1') +
	(information ? '1' : '0') +
	(reason === undefined ? '' : '0' + int(reason, 5)) +
	information;
const abort = (source = 0, diagnostic, information = '') =>
	'0100' +
	'0' +
	(diagnostic === undefined ? '0' : '1') +
	(information ? '1' : '0') +
	'0' +
	String(source) +
	(diagnostic === undefined ? '' : '0' + int(diagnostic - 1, 3)) +
	information;
const parse = (binary) => decodeAtnAcse(bytes(binary), binary.length);

describe('explicit ATN ACSE kernel and excluded-field preservation', () => {
	it.each([decodeAtnAcse, formatsAcse])(
		'reads minimal associate request with OID provenance and copied raw',
		(reader) => {
			const binary = aarq();
			const wire = bytes(binary);
			const result = reader(wire, binary.length);
			expect(result).toMatchObject({
				type: 'AARQ',
				fields: { applicationContextName: '1.2.3' },
				structureComplete: true,
				profileSupported: true,
				integrity: 'unverified',
				consumedBits: 44,
			});
			wire.fill(0);
			expect(result.raw).toEqual(bytes(binary));
		},
	);
	it('reads calling title/qualifier and bit-exact EXTERNAL user information', () => {
		const result = parse(aarq([5, 6, 14], '00' + oid + '00' + integer(22) + info));
		expect(result.fields.callingAPTitle).toBe('1.2.3');
		expect(result.fields.callingAEQualifier).toBe(22);
		expect(result.userInformation).toEqual([
			{ indirectReference: 3, encoding: 'arbitrary', payload: Uint8Array.of(0xa8), bitLength: 5 },
		]);
		expect(result.profileSupported).toBe(true);
		expect(result.structureComplete).toBe(true);
	});
	it.each([0, 1, 2])('reads associate result %i and source diagnostic', (value) => {
		const result = parse(aare(value, 0, 14));
		expect(result.fields).toMatchObject({ result: value, diagnostic: 14, diagnosticSource: 'acse-service-user' });
		expect(result.structureComplete).toBe(true);
		expect(parse(aare(value, 1, 2)).fields.diagnosticSource).toBe('acse-service-provider');
	});
	it.each([2, 3])('reads all five-bit release reasons for root choice %i', (choice) => {
		for (const reason of [undefined, 0, 1, 30]) {
			const result = parse(release(choice, reason, info));
			expect(result.fields.reason).toBe(reason);
			expect(result.structureComplete).toBe(true);
			expect(result.profileSupported).toBe(true);
			expect(result.userInformation[0].bitLength).toBe(5);
		}
		expect(parse(release(choice, 2)).profileSupported).toBe(false);
	});
	it.each([1, 2, 3, 4, 5, 6])('reads abort diagnostic %i without shifting enum values', (diagnostic) => {
		const result = parse(abort(1, diagnostic, info));
		expect(result.fields).toMatchObject({ abortSource: 1, abortDiagnostic: diagnostic });
		expect(result.structureComplete).toBe(true);
	});
	it('retains sequence and choice extension open types', () => {
		const sequence = parse(aarq([], '', '0000000' + '1' + int(2, 8) + octets([0xab, 0xcd])));
		expect(sequence.extensions).toEqual([{ index: 0, payload: Uint8Array.of(0xab, 0xcd) }]);
		expect(sequence.profileSupported).toBe(false);
		expect(sequence.structureComplete).toBe(true);
		const choice = parse('1' + '0000010' + int(1, 8) + int(0x55, 8));
		expect(choice.type).toBe('extension');
		expect(choice.extensions).toEqual([{ index: 2, payload: Uint8Array.of(0x55) }]);
	});
	it('keeps excluded called fields and signed invocation values without application inference', () => {
		const result = parse(aarq([1, 2, 3, 4], '00' + oid + '00' + integer(-1) + integer(-128) + integer(127)));
		expect(result.fields).toMatchObject({
			calledAPTitle: '1.2.3',
			calledAEQualifier: -1,
			calledAPInvocationIdentifier: -128,
			calledAEInvocationIdentifier: 127,
		});
		expect(result.structureComplete).toBe(true);
		expect(result.profileSupported).toBe(false);
		const excluded = parse(aarq([5], '01'));
		expect(excluded.structureComplete).toBe(false);
		expect(excluded.raw).toEqual(bytes(aarq([5], '01')));
	});
	it('retains requirements/mechanism/authentication/context list/implementation fields', () => {
		const fields = int(2, 8) + '10' + oid + '00' + int(1, 8) + int(65, 8) + int(1, 8) + oid + int(1, 8) + int(0xee, 8);
		const result = parse(aarq([9, 10, 11, 12, 13], fields));
		expect(result.fields.mechanismName).toBe('1.2.3');
		expect(result.fields.authenticationEncoding).toBe('charstring');
		expect(result.fields.authenticationValue.payload).toEqual(Uint8Array.of(65));
		expect(result.fields.applicationContextName0).toBe('1.2.3');
		expect(result.fields.implementationInformation.payload).toEqual(Uint8Array.of(0xee));
		expect(result.structureComplete).toBe(true);
		expect(result.profileSupported).toBe(false);
	});
	it('rejects invalid root/enum/integer/OID and explicit bit truncation', () => {
		for (const binary of [
			'0111',
			aare(3),
			abort(1, 7),
			aarq([6], '00' + int(0, 8)),
			'0000' + '0' + flags(15, []) + int(1, 8) + int(128, 8),
		])
			expect(() => parse(binary)).toThrow();
		const binary = aarq([14], info);
		for (let length = 0; length < bytes(binary).length; length++)
			expect(() => decodeAtnAcse(bytes(binary).slice(0, length))).toThrow();
		expect(() => decodeAtnAcse(bytes(binary), binary.length - 1)).toThrow();
	});
	it('keeps trailing/nonzero padding explicit and bounds byte/bit sizes', () => {
		const binary = aarq();
		const wire = bytes(binary);
		wire[wire.length - 1] |= 1;
		expect(decodeAtnAcse(wire).structureComplete).toBe(false);
		expect(decodeAtnAcse(Uint8Array.from([...bytes(binary), 0])).structureComplete).toBe(false);
		for (const [wire, length] of [
			[new Uint8Array(), 0],
			[new Uint8Array(8193), 65544],
			[bytes(binary), 0],
			[bytes(binary), 100],
			[bytes(binary), 8],
			[bytes(binary), 44.5],
		])
			expect(() => decodeAtnAcse(wire, length)).toThrow();
	});
	it('integrates only explicit ACSE context and preserves malformed application bytes', () => {
		const binary = aarq([5, 6, 14], '00' + oid + '00' + integer(22) + info);
		const fed = '000000000010' + int(binary.length, 8) + binary;
		const data = decodeAtnUlcs(bytes(fed), 'data');
		expect(data.values[0].contextIdentifier).toBe(1);
		expect(data.values[0].acse.fields.callingAEQualifier).toBe(22);
		expect(data.values[0].acse.structureComplete).toBe(true);
		expect(data.integrity).toBe('unverified');
		const connection = decodeAtnUlcs(Uint8Array.from([0xe8, 2, ...bytes(binary)]), 'connection');
		expect(connection.acse.type).toBe('AARQ');
		expect(connection.acse.fields.callingAPTitle).toBe('1.2.3');
		const malformed = decodeAtnUlcs(Uint8Array.of(0xe8, 2, 0xff), 'connection');
		expect(malformed.acse).toBeUndefined();
		expect(malformed.application).toEqual(Uint8Array.of(0xff));
		const user = decodeAtnUlcs(bytes('000000001010' + int(binary.length, 8) + binary), 'data');
		expect(user.values[0].contextIdentifier).toBe(3);
		expect(user.values[0].acse).toBeUndefined();
	});
	it('reads extended signed results and large normally-small values without treating them as root values', () => {
		const response = '0001' + '0' + flags(11, []) + oid + '1' + integer(-1) + '0' + '1' + integer(127);
		const result = parse(response);
		expect(result.fields).toMatchObject({ result: -1, diagnostic: 127 });
		expect(result.structureComplete).toBe(true);
		expect(result.profileSupported).toBe(false);
		const choice = parse('1' + '1' + int(1, 8) + int(200, 8) + int(1, 8) + int(0xaa, 8));
		expect(choice.extensions[0].index).toBe(200);
		expect(choice.extensions[0].payload).toEqual(Uint8Array.of(0xaa));
	});
	it('bounds sequence extensions, association lists and unsigned context/integer sizes', () => {
		for (const binary of [
			aarq([], '', '1' + int(1, 8) + int(64, 8)),
			aarq([14], '1' + int(17, 8)),
			aarq([12], int(17, 8)),
			aarq([6], '00' + int(7, 8) + '0'.repeat(56)),
			'1' + '1' + int(0, 8),
		])
			expect(() => parse(binary)).toThrow();
	});
	it('retains excluded EXTERNAL encodings and references without guessing their application', () => {
		const value = '111' + oid + integer(-1) + int(1, 8) + int(0xee, 8) + '01' + int(2, 8) + octets([0xaa, 0x55]);
		const result = parse(aarq([14], '0' + value));
		expect(result.userInformation[0]).toEqual({
			directReference: '1.2.3',
			indirectReference: -1,
			dataValueDescriptor: Uint8Array.of(0xee),
			encoding: 'octet-aligned',
			payload: Uint8Array.of(0xaa, 0x55),
			bitLength: 16,
		});
		expect(result.profileSupported).toBe(false);
		expect(result.structureComplete).toBe(true);
	});
	it('retains zero/multiple EXTERNAL list extensions and repeated records', () => {
		const zero = parse(aarq([14], '1' + int(0, 8)));
		expect(zero.userInformation).toEqual([]);
		expect(zero.profileSupported).toBe(false);
		const two = parse(aarq([14], '1' + int(2, 8) + external() + external('111')));
		expect(two.userInformation.map((value) => value.bitLength)).toEqual([5, 3]);
		expect(two.structureComplete).toBe(true);
	});
});
