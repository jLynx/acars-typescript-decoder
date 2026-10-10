import { describe, expect, it } from 'vitest';
import { decodeFansCpdlcStructure, decodeCpdlc, decode, createDecoder } from '@/index';
import { envelope } from '../adsc/wire';
import { decodeFansCpdlcStructure as formatsStructure } from '@/formats';
import { validCpdlcStructure } from '@/payload/protocols/cpdlc/validation';

const integer = (width, value) => BigInt(value).toString(2).padStart(width, '0');
const text = (value) => [...value].map((char) => integer(7, char.charCodeAt(0))).join('');
const bytes = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g), (octet) => parseInt(octet, 2));
const message = (id, body = '', header = '000000100') => bytes(header + integer(8, id) + body);
const leaf = (node, type) =>
	node.type === type ? node : node.children?.map((child) => leaf(child, type)).find(Boolean);

describe('FANS ASN.1 structure independent fixtures', () => {
	it.each([decodeFansCpdlcStructure, formatsStructure])(
		'retains independent header values, bits and raw data',
		(reader) => {
			const wire = message(
				3,
				'',
				'011' + integer(6, 5) + integer(6, 12) + integer(5, 23) + integer(6, 59) + integer(6, 58),
			);
			const result = reader(wire, 'uplink');
			expect(leaf(result.value, 'FANSMsgIdentificationNumber').value).toBe(5);
			expect(leaf(result.value, 'FANSMsgReferenceNumber').value).toBe(12);
			expect(leaf(result.value, 'FANSTimehours').value).toBe(23);
			expect(leaf(result.value, 'FANSTimeminutes').value).toBe(59);
			expect(leaf(result.value, 'FANSTimeSeconds').value).toBe(58);
			expect(leaf(result.value, 'FANSATCUplinkMsgElementId').choice).toBe('uM3NULL');
			expect(result.consumedBits).toBe(40);
			expect(result.paddingValid).toBe(true);
			expect(result.raw).toEqual(wire);
			expect(result.integrity).toBe('unverified');
		},
	);
	it.each(['uplink', 'downlink'])('reads five independent null elements in %s', (direction) => {
		const wire = bytes(
			'100' + integer(6, 4) + integer(8, 3) + integer(2, 3) + [0, 1, 2, 4].map((id) => integer(8, id)).join(''),
		);
		const result = decodeFansCpdlcStructure(wire, direction);
		expect(result.value.children[2].children).toHaveLength(4);
		expect(result.paddingValid).toBe(true);
	});
	it('reads altitude wire values without confusing encoded scales with units', () => {
		const result = decodeFansCpdlcStructure(message(19, integer(3, 6) + integer(10, 320)), 'uplink');
		expect(leaf(result.value, 'FANSAltitude').choice).toBe('altitudeFlightLevel');
		expect(leaf(result.value, 'FANSAltitudeFlightLevel').value).toBe(350);
		expect(decodeCpdlc(result.raw, 'uplink').summary).toBe('MAINTAIN FL350');
	});
	it('validates procedures and optional transitions in schema order', () => {
		const body = '1' + integer(2, 2) + integer(3, 5) + text('SID123') + integer(3, 4) + text('TRANS');
		const result = decodeFansCpdlcStructure(message(23, body), 'downlink');
		expect(leaf(result.value, 'FANSProcedureType')).toMatchObject({ value: 2, enumeration: 'departure' });
		expect(leaf(result.value, 'FANSProcedure').value).toBe('SID123');
		expect(leaf(result.value, 'FANSProcedureTransition').value).toBe('TRANS');
		expect(result.paddingValid).toBe(true);
	});
	it('retains IA5 character values without assigning token restrictions from display', () => {
		const result = decodeFansCpdlcStructure(message(79, text('?')), 'downlink');
		expect(leaf(result.value, 'FANSATISCode').value).toBe('?');
	});
	it('handles NumericString mapping with space and all decimal digits', () => {
		const chars = ' 0123456789 ';
		const encoded = [...chars].map((char) => integer(4, char === ' ' ? 0 : Number(char) + 1)).join('');
		const result = decodeFansCpdlcStructure(message(21, '11' + encoded), 'downlink');
		expect(leaf(result.value, 'FANSFrequencysatchannel').value).toBe(chars);
	});
	it('validates all independent position-report option bits and known numeric fields', () => {
		const flags = Array.from({ length: 19 }, (_, index) => ([5, 6, 7, 8, 10].includes(index) ? '1' : '0')).join('');
		const required = '000000' + text('A') + integer(5, 12) + integer(6, 30) + '110' + integer(10, 320);
		const temperature = '0' + integer(7, 75);
		const winds = integer(9, 179) + '0' + integer(8, 25);
		const body = flags + required + temperature + winds + '10' + '11' + integer(6, 18);
		const result = decodeFansCpdlcStructure(message(48, body), 'downlink');
		expect(leaf(result.value, 'FANSTemperatureC').value).toBe(-5);
		expect(leaf(result.value, 'FANSWindDirection').value).toBe(180);
		expect(leaf(result.value, 'FANSWindSpeedEnglish').value).toBe(25);
		expect(leaf(result.value, 'FANSTurbulence').enumeration).toBeTruthy();
		expect(leaf(result.value, 'FANSIcing').value).toBe(3);
		expect(leaf(result.value, 'FANSSpeedGround').value).toBe(25);
		expect(result.paddingValid).toBe(true);
	});
	it.each([6, 7])('rejects unused procedure length codepoint %i', (code) => {
		expect(() =>
			decodeFansCpdlcStructure(message(23, '0' + '00' + integer(3, code) + text('ABCDEFGH')), 'downlink'),
		).toThrow();
	});
	it.each([
		['uplink', 183],
		['downlink', 129],
	])('rejects invalid %s element choice %i', (direction, choice) => {
		expect(() => decodeFansCpdlcStructure(message(choice), direction)).toThrow();
	});
	it('rejects invalid primitive constraints and truncated nested bodies', () => {
		expect(() => decodeFansCpdlcStructure(message(19, '110' + integer(10, 571)), 'uplink')).toThrow();
		expect(() => decodeFansCpdlcStructure(message(23, '0' + '00' + '101' + text('A')), 'downlink')).toThrow();
		expect(() => decodeFansCpdlcStructure(message(21, '11' + integer(4, 11)), 'downlink')).toThrow();
	});
	it('keeps nonzero padding and extra bytes explicit', () => {
		const wire = message(3);
		wire[wire.length - 1] |= 1;
		expect(decodeFansCpdlcStructure(wire, 'uplink').paddingValid).toBe(false);
		expect(decodeFansCpdlcStructure(Uint8Array.from([...message(3), 0]), 'uplink').paddingValid).toBe(false);
	});
	it('bounds input/direction and copies bytes', () => {
		expect(() => decodeFansCpdlcStructure(new Uint8Array(8193), 'uplink')).toThrow();
		expect(() => decodeFansCpdlcStructure(message(3), 'guess')).toThrow();
		const wire = message(3);
		const result = decodeFansCpdlcStructure(wire, 'uplink');
		wire.fill(0);
		expect(result.raw).toEqual(message(3));
	});
	it('rejects plugin structures with inconsistent spans, cycles and resource excess', () => {
		const result = decodeFansCpdlcStructure(message(3), 'uplink');
		expect(validCpdlcStructure(result)).toBe(true);
		const invalid = structuredClone(result);
		invalid.value.children[1].children[0].startBit = 0;
		expect(validCpdlcStructure(invalid)).toBe(false);
		invalid.value = result.value;
		invalid.consumedBits++;
		expect(validCpdlcStructure(invalid)).toBe(false);
		const cycle = structuredClone(result);
		cycle.value.children = [cycle.value];
		expect(validCpdlcStructure(cycle)).toBe(false);
		const excessive = structuredClone(result);
		excessive.value.children = Array(129).fill(excessive.value);
		expect(validCpdlcStructure(excessive)).toBe(false);
		expect(validCpdlcStructure({ ...result, raw: new Uint8Array() })).toBe(false);
	});
	it('attaches structure only after verified CRC and validates plugin output', () => {
		const wire = envelope(message(3), 'AT1');
		const result = decode({ label: 'H1', text: `- #M1${wire}`, direction: 'uplink' });
		expect(result.cpdlc.paddingValid).toBe(true);
		expect(result.cpdlc.value.children[1].choice).toBe('uM3NULL');
		expect(createDecoder({ plugins: [{ decode: () => result }] }).decode({ label: 'Q0', text: '' }).cpdlc).toEqual(
			result.cpdlc,
		);
		const invalid = structuredClone(result);
		invalid.cpdlc.value.bitLength = Infinity;
		expect(createDecoder({ plugins: [{ decode: () => invalid }] }).decode({ label: 'Q0', text: '' }).title).toBe(
			'Link test',
		);
		const corrupt = wire.slice(0, -1) + (wire.endsWith('0') ? '1' : '0');
		expect(decode({ label: 'H1', text: `- #M1${corrupt}`, direction: 'uplink' }).cpdlc).toBeUndefined();
	});
});
