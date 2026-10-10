import { describe, expect, it } from 'vitest';
import { decodeX25, decodeClnpCompressed, decodeCotp, decodeIdrp } from '@/index';

const bytes = (...values) => Uint8Array.from(values);
describe('X.25 and compressed CLNP transport headers', () => {
	it('reads modulo-8 sequencing and qualifier/delivery flags', () => {
		const result = decodeX25(bytes(0xd3, 42, 0xa6, 0, 4, 0, 7));
		expect(result).toMatchObject({
			type: 'Data',
			channelGroup: 3,
			channel: 42,
			qualifier: true,
			deliveryConfirmation: true,
			sendSequence: 3,
			receiveSequence: 5,
			more: false,
			clnp: { localReference: 7, lifetime: 2, lifetimeUnit: 's' },
		});
		expect(decodeX25(bytes(0x10, 0, 0x61)).type).toBe('Receive Ready');
		expect(decodeX25(bytes(0x10, 0, 0x65)).type).toBe('Receive Not Ready');
		expect(decodeX25(bytes(0x10, 0, 0x69)).type).toBe('Receive Reject');
		expect(decodeX25(bytes(0x20, 0, 0))).toBeUndefined();
	});
	it('preserves X.25 and CLNP fragments without treating their payload as a complete application', () => {
		expect(decodeX25(bytes(0x10, 0, 0x10, 0, 0, 0, 0)).clnp).toBeUndefined();
		const result = decodeClnpCompressed(bytes(0x63, 5, 0, 0x81, 2, 0x12, 0x34, 0, 5, 0, 20, 4, 0xf0, 0, 1, 0x80));
		expect(result).toMatchObject({
			type: 6,
			priority: 3,
			lifetime: 2.5,
			localReference: 258,
			pduId: 0x1234,
			offset: 5,
			totalLength: 20,
		});
		expect(result.cotp).toBeUndefined();
		expect(result.payload).toEqual(bytes(4, 0xf0, 0, 1, 0x80));
	});
	it('rejects truncated references/segmentation headers and retains unsupported protocol data', () => {
		for (const data of [bytes(0, 0, 0, 0x80), bytes(0x10, 0, 0, 0), bytes(0x60, 0, 0, 0, 0, 0)])
			expect(decodeClnpCompressed(data)).toBeUndefined();
		expect(decodeX25(bytes(0x10, 0, 0, 0x81, 1, 2, 3)).payload).toEqual(bytes(0x81, 1, 2, 3));
	});
	it('reads bounded IDRP headers and requires the declared length to match', () => {
		const data = new Uint8Array(30);
		data.set([0x85, 0, 30, 4, 0, 0, 0, 1, 0, 0, 0, 2, 3, 4]);
		expect(decodeIdrp(data)).toMatchObject({
			typeName: 'Keepalive',
			sequence: 1,
			acknowledgement: 2,
			creditOffered: 3,
			creditAvailable: 4,
		});
		data[2] = 31;
		expect(decodeIdrp(data)).toBeUndefined();
	});
});

describe('COTP class-4 headers', () => {
	it('reads connection references, credit, class and typed TLV units', () => {
		const result = decodeCotp(bytes(13, 0xe3, 0x12, 0x34, 0x56, 0x78, 0x42, 0xc0, 1, 10, 0x85, 2, 0, 25, 9, 8));
		expect(result.pdus[0]).toMatchObject({
			typeName: 'Connect Request',
			destinationReference: 0x1234,
			sourceReference: 0x5678,
			protocolClass: 4,
			options: 2,
			credit: 3,
			userData: bytes(9, 8),
		});
		expect(result.pdus[0].parameters).toMatchObject([
			{ name: 'TPDU size', value: 1024, unit: 'bytes' },
			{ name: 'Acknowledgement time', value: 25, unit: 'ms' },
		]);
		expect(result.integrity).toBe('unverified');
	});
	it('reads normal and extended data sequences and end-of-transmission', () => {
		expect(decodeCotp(bytes(4, 0xf1, 0, 1, 0x85, 1, 2)).pdus[0]).toMatchObject({
			sendSequence: 5,
			endOfTransmission: true,
			requestAcknowledgement: true,
			userData: bytes(1, 2),
		});
		expect(decodeCotp(bytes(7, 0xf0, 0, 1, 0x81, 2, 3, 4, 9)).pdus[0].sendSequence).toBe(0x1020304);
	});
	it('requires negotiated format for ambiguous optional-field layouts', () => {
		const data = bytes(7, 0xf0, 0, 1, 0x80, 0xc0, 1, 10, 9);
		expect(decodeCotp(data).pdus).toEqual([]);
		expect(decodeCotp(data, { format: 'normal' }).pdus[0].parameters[0].value).toBe(1024);
		expect(decodeCotp(data, { format: 'extended' }).pdus[0].sendSequence).toBe(0xc0010a);
	});
	it('reads concatenated control TPDUs and preserves truncated trailing data', () => {
		const result = decodeCotp(bytes(5, 0xc0, 0, 1, 0, 2, 4, 0x62, 0, 1, 3, 8, 0xe0));
		expect(result.pdus).toHaveLength(2);
		expect(result.pdus[1]).toMatchObject({ typeName: 'Data Ack', receiveSequence: 3, credit: 2 });
		expect(result.unconsumed).toEqual(bytes(8, 0xe0));
		expect(result.coverage).toBe('partial');
	});
	it('does not expose malformed TLVs or impossible TPDU sizes as valid values', () => {
		expect(decodeCotp(bytes(9, 0xe0, 0, 1, 0, 2, 0x40, 0xc0, 2, 10)).pdus).toEqual([]);
		const result = decodeCotp(bytes(9, 0xe0, 0, 1, 0, 2, 0x40, 0xc0, 1, 255));
		expect(result.pdus[0].parameters[0].value).toBeUndefined();
	});
});
