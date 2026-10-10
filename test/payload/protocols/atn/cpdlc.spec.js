import { describe, expect, it } from 'vitest';
import { decodeAtnCpdlc } from '@/index';
import { decodeAtnCpdlc as formatsCpdlc } from '@/formats';

// Independent hand packing from the pinned Doc9705 ATN schema.
const int = (value, width) => (width ? BigInt(value).toString(2).padStart(width, '0') : '');
const bytes = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g) ?? [], (v) => parseInt(v, 2));
const chars = (value) => [...value].map((char) => int(char.charCodeAt(0), 7)).join('');
const header = (reference = false, ack = false) =>
	(reference ? '1' : '0') +
	(ack ? '1' : '0') +
	int(5, 6) +
	(reference ? int(12, 6) : '') +
	int(2024 - 1996, 7) +
	int(9, 4) +
	int(9, 5) +
	int(23, 5) +
	int(59, 6) +
	int(58, 6) +
	(ack ? '0' : '');
const root = (direction, choice, body = '') => '0' + int(choice, direction === 'uplink' ? 3 : 2) + body;
const message = (direction, id, body = '') =>
	root(direction, 3, header() + '0' + '000' + '0' + int(id, direction === 'uplink' ? 8 : 7) + body);
const parse = (binary, direction = 'uplink', mode = 'plain') =>
	decodeAtnCpdlc(bytes(binary), { direction, mode, bitLength: binary.length });
const leaf = (value, type) =>
	value.type === type ? value : value.children?.map((child) => leaf(child, type)).find(Boolean);

describe('explicit ATN CPDLC direction/profile structural decoding', () => {
	it.each([decodeAtnCpdlc, formatsCpdlc])('reads independent date/header and a plain uplink null element', (reader) => {
		const binary = message('uplink', 3);
		const result = reader(bytes(binary), { direction: 'uplink', mode: 'plain', bitLength: binary.length });
		expect(result.value.choice).toBe('send');
		expect(leaf(result.value, 'ATCUplinkMsgElementId').choice).toBe('uM3NULL');
		expect(leaf(result.value, 'MsgIdentificationNumber').value).toBe(5);
		expect(leaf(result.value, 'Year').value).toBe(2024);
		expect(leaf(result.value, 'Month').value).toBe(10);
		expect(leaf(result.value, 'Day').value).toBe(10);
		expect(leaf(result.value, 'TimeHours').value).toBe(23);
		expect(leaf(result.value, 'TimeMinutes').value).toBe(59);
		expect(leaf(result.value, 'TimeSeconds').value).toBe(58);
		expect(result.structureComplete).toBe(true);
		expect(result.integrity).toBe('unverified');
	});
	it('reads downlink reference/logical ack and multiple message elements', () => {
		const binary = root(
			'downlink',
			3,
			header(true, true) + '0' + int(4, 3) + [0, 1, 2, 3, 4].map((id) => '0' + int(id, 7)).join(''),
		);
		const result = parse(binary, 'downlink');
		expect(leaf(result.value, 'MsgReferenceNumber').value).toBe(12);
		expect(leaf(result.value, 'LogicalAck').enumeration).toBe('required');
		expect(leaf(result.value, 'SEQUENCE_SIZE_1_5_OF_ATCDownlinkMsgElementId').children).toHaveLength(5);
		expect(result.structureComplete).toBe(true);
	});
	it('reads signed constrained level without labelling its encoded scale as feet', () => {
		const result = parse(message('uplink', 19, '0' + '00' + int(3500 + 60, 13)));
		expect(leaf(result.value, 'LevelFeet').value).toBe(3500);
		expect(result.structureComplete).toBe(true);
	});
	it('retains free IA5 character values', () => {
		const result = parse(message('uplink', 169, int(1, 8) + chars('? ')));
		expect(leaf(result.value, 'FreeText').value).toBe('? ');
		expect(result.structureComplete).toBe(true);
	});
	it.each(['uplink', 'downlink'])('reads plain startup with absent message for %s', (direction) => {
		const binary = root(direction, 2, direction === 'uplink' ? '0' : '00');
		expect(parse(binary, direction).structureComplete).toBe(true);
	});
	it.each(['uplink', 'downlink'])('retains protected message/integrity bits as opaque for %s', (direction) => {
		const binary = root(
			direction,
			3,
			'0' +
				'11' +
				int(3, 8) +
				int(1, 8) +
				int(0x81, 8) +
				int(1, 8) +
				int(5, 8) +
				'10101' +
				int(16, 8) +
				int(0xabcd, 16),
		);
		const result = parse(binary, direction, 'protected');
		expect(leaf(result.value, 'AlgorithmIdentifier').value).toBe('1.129');
		expect(leaf(result.value, 'CPDLCMessage').value).toEqual({ payload: Uint8Array.of(0xa8), bitLength: 5 });
		expect(leaf(result.value, 'BIT_STRING').value).toEqual({ payload: Uint8Array.of(0xab, 0xcd), bitLength: 16 });
		expect(leaf(result.value, direction === 'uplink' ? 'ATCUplinkMessage' : 'ATCDownlinkMessage')).toBeUndefined();
		expect(result.structureComplete).toBe(true);
		expect(result.notes.join(' ')).toContain('remain opaque');
	});
	it('retains unsupported CHOICE/sequence extension bytes and names known extensions', () => {
		const choice = parse('1' + '0000010' + int(2, 8) + int(0xabcd, 16));
		expect(choice.value.extensions).toEqual([{ index: 2, payload: Uint8Array.of(0xab, 0xcd) }]);
		const binary = root('uplink', 3, header() + '0' + '000' + '1' + '0000000' + int(1, 8) + int(0, 8));
		const known = parse(binary);
		expect(leaf(known.value, 'ATCUplinkMsgElementId').choice).toBe('uM237NULL');
		expect(known.structureComplete).toBe(true);
	});
	it('rejects invalid codepoints, truncated bodies and malformed relative OIDs', () => {
		for (const [binary, direction, mode] of [
			[root('uplink', 7), 'uplink', 'plain'],
			[message('uplink', 237), 'uplink', 'plain'],
			[message('downlink', 114), 'downlink', 'plain'],
			[root('uplink', 3, header() + '0' + int(5, 3)), 'uplink', 'plain'],
			[root('uplink', 3, '010' + int(1, 8) + int(128, 8)), 'uplink', 'protected'],
		])
			expect(() => parse(binary, direction, mode)).toThrow();
		const binary = message('uplink', 169, int(10, 8) + chars('ABCDEFGHIJK'));
		for (let count = 0; count < bytes(binary).length; count++)
			expect(() => decodeAtnCpdlc(bytes(binary).slice(0, count), { direction: 'uplink', mode: 'plain' })).toThrow();
		expect(() =>
			decodeAtnCpdlc(bytes(binary), { direction: 'uplink', mode: 'plain', bitLength: binary.length - 1 }),
		).toThrow();
	});
	it('enforces input/profile limits, copies raw bytes and retains invalid padding', () => {
		const binary = message('uplink', 3),
			wire = bytes(binary);
		const result = parse(binary);
		wire.fill(0);
		expect(result.raw).toEqual(bytes(binary));
		expect(() => decodeAtnCpdlc(new Uint8Array(8193), { direction: 'uplink', mode: 'plain' })).toThrow();
		expect(() => decodeAtnCpdlc(bytes(binary), { direction: 'guess', mode: 'plain' })).toThrow();
		expect(() => decodeAtnCpdlc(bytes(binary), { direction: 'uplink', mode: 'guess' })).toThrow();
		const extra = Uint8Array.from([...bytes(binary), 0]);
		expect(decodeAtnCpdlc(extra, { direction: 'uplink', mode: 'plain' }).structureComplete).toBe(false);
		const padding = bytes(binary);
		padding[padding.length - 1] |= 1;
		expect(decodeAtnCpdlc(padding, { direction: 'uplink', mode: 'plain' }).structureComplete).toBe(false);
	});
});
