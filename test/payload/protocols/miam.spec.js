import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { decode, decodeLog } from '@/index';
import { base85, crc16, crc32, inflateBounded } from '@/payload/protocols/miam/bytes';
import { transfer, encode85 } from './miam-fixtures';

const field = (result, label) => result.fields.find((f) => f.label === label)?.value;
const interpret = (options) => decode({ label: 'MA', text: transfer(options) });

describe('MIAM CORE bodies and checksums', () => {
	it('matches independent published CRC check vectors', () => {
		const bytes = new TextEncoder().encode('123456789');
		expect(crc32(bytes)).toBe(0xfc891918);
		expect(crc16(bytes)).toBe(0x29b1);
	});
	it('decodes a CORE v2 acknowledgement independently from ACARS link ACK', () => {
		const header = encode85(Uint8Array.of(0x12, 14, 0, 0, 0x29, 0xb1, 0, 0));
		const result = decode({ label: 'MA', text: `T.${header.padding}${header.text}|` });
		expect(result).toMatchObject({ title: 'MIAM transfer acknowledgement', coverage: 'decoded' });
		expect(field(result, 'Acknowledged application message')).toBe('7');
	});
	it.each([1, 2])('decodes version %s raw-DEFLATE and verifies its application CRC', (version) => {
		const result = interpret({ version });
		expect(field(result, 'Application CRC')).toContain('Verified');
		expect(field(result, 'Application text')).toBe('NZAA');
		expect(result.coverageDetail).toContain('body decoded');
	});
	it.each([1, 2])('preserves uncompressed version %s ASCII text including trailing spaces', (version) => {
		const result = interpret({ version, compression: 0, plaintext: true, data: new TextEncoder().encode('TEXT  ') });
		expect(field(result, 'Application text')).toBe('TEXT  ');
	});
	it('preserves binary body data as hex instead of inventing text', () => {
		const result = interpret({ version: 2, data: Uint8Array.of(0, 255, 128, 10), encoding: 1 });
		expect(field(result, 'Application data (hex)')).toBe('00FF800A');
	});
	it('never exposes application data when its CRC fails', () => {
		const result = interpret({ corrupt: true });
		expect(field(result, 'Application CRC')).toContain('Failed');
		expect(field(result, 'Application text')).toBeUndefined();
		expect(result.notes.join(' ')).toContain('CRC failed');
	});
	it('rejects declared length mismatch and unsupported compression', () => {
		expect(interpret({ declaredDelta: 1 }).notes.join(' ')).toContain('length does not match');
		expect(interpret({ compression: 2 }).notes.join(' ')).toContain('Unsupported compression');
	});
	it('defers continued transfers and decodes only the consecutive final assembly', () => {
		const text = transfer();
		const split = text.indexOf('|') + 3;
		const common = {
			label: 'MA',
			registration: 'ZK-NZE',
			mode: '2',
			blockId: '1',
			acknowledgement: 'NAK',
			direction: 'downlink',
		};
		const records = [
			{ ...common, id: 1, receivedAt: 1000, text: text.slice(0, split), messageNumber: 'M01A', continuation: true },
			{ ...common, id: 2, receivedAt: 1010, text: text.slice(split), messageNumber: 'M01B', continuation: false },
		];
		const result = decodeLog(records);
		expect(result[0].interpretation.notes.join(' ')).toContain('final ETX');
		expect(field(result[1].interpretation, 'Application text')).toBe('NZAA');
		expect(result[1].text).toBe(records[1].text);
	});
	it.each([0, 1, 2, 3, 4, 7, 20])('round-trips ASCII85 length %s using explicit padding', (length) => {
		const bytes = Uint8Array.from({ length }, (_, i) => i * 29);
		const encoded = encode85(bytes);
		expect(base85(encoded.text, encoded.padding)).toEqual(bytes);
	});
	it.each([
		['!!!!', 0],
		['uuuuu', 0],
		['~~~~~', 0],
		['z', 5],
		['!!!!!', 6],
	])('rejects invalid ASCII85 %s', (text, padding) => expect(() => base85(text, padding)).toThrow());
	it('decodes the zero-word shorthand and bounds output', () => {
		expect(base85('z', 0)).toEqual(Uint8Array.of(0, 0, 0, 0));
		expect(() => base85('zz', 0, 4)).toThrow(/limit/);
	});
	it('rejects truncated streams, trailing garbage and excessive inflation', () => {
		const compressed = deflateRawSync('NZAA');
		expect(() => inflateBounded(compressed.subarray(0, -1))).toThrow();
		expect(() => inflateBounded(Uint8Array.from([...compressed, 1, 2, 3]))).toThrow();
		expect(() => inflateBounded(deflateRawSync('A'.repeat(65537)))).toThrow(/limit/);
		expect(() => inflateBounded(new Uint8Array())).toThrow();
	});
});
