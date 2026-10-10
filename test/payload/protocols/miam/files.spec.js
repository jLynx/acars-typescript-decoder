import { describe, expect, it } from 'vitest';
import { decode, decodeLog } from '@/index';
import { readMiamFile } from '@/payload/protocols/miam/files';
import { transfer, encode85 } from '../miam-fixtures';

const record = (text, id, extra = {}) => ({
	label: 'MA',
	text,
	id,
	receivedAt: id * 1000,
	registration: 'ZK-NZE',
	direction: 'downlink',
	...extra,
});
const file = (options) => {
	const core = transfer(options).slice(1);
	const cut = Math.floor(core.length / 2);
	return [
		record(`F001${String(core.length).padStart(6, '0')}261010235959`, 1),
		record(`S001001${core.slice(0, cut)}`, 2),
		record(`S001002${core.slice(cut)}`, 3),
	];
};
const body = (result) => result.interpretation.transfer?.text;

describe('MIAM CF file transfer', () => {
	it('marks a fully assembled CORE acknowledgement as complete without requiring application data', () => {
		const header = encode85(Uint8Array.of(0x12, 14, 0, 0, 0x29, 0xb1, 0, 0));
		const core = `.${header.padding}${header.text}|`;
		const results = decodeLog([
			record(`F001${String(core.length).padStart(6, '0')}261010235959`, 1),
			record(`S001001${core}`, 2),
		]);
		expect(results[1].interpretation.title).toBe('MIAM transfer acknowledgement');
		expect(results[1].assemblies).toContainEqual({ protocol: 'MIAM', status: 'complete', identifier: '001' });
	});
	it('reads decimal IDs/sizes, a hexadecimal size code, tempos and raw validity', () => {
		expect(readMiamFile('F019000120261010235959')).toEqual({
			type: 'F',
			fileId: '019',
			size: 120,
			validity: '261010235959',
		});
		expect(readMiamFile('K019A005012')).toEqual({
			type: 'K',
			fileId: '019',
			segmentSize: 10,
			groundTempo: 5,
			flightTempo: 12,
		});
		expect(decode(record('XFFF005012', 1)).fields).toContainEqual({ label: 'File ID', value: 'All files' });
	});
	it.each([
		'F001000010261332235959',
		'F001000010260229235959',
		'F001000010261010240000',
		'F00A000010261010235959',
		'K001G001001',
		'S001000data',
		'AFFF0',
		'XFFF010',
		'YFFFx',
	])('rejects malformed frame %s', (text) => expect(readMiamFile(text)).toBeUndefined());
	it.each([1, 2])('reassembles a CORE v%s file and decodes its verified application', (version) => {
		const messages = file({ version });
		const results = decodeLog(messages);
		expect(body(results[1])).toBeUndefined();
		expect(body(results[2])).toBe('NZAA');
		expect(results[2].interpretation.embedded.title).toBe('ATIS request');
		expect(results[2].text).toBe(messages[2].text);
		expect(results[2].interpretation.notes.join(' ')).toContain('Reassembled MIAM file');
	});
	it('dispatches single CORE and file transfers carried inside H1 sublabels', () => {
		const single = decode({ ...record(`#CFB${transfer()}`, 1), label: 'H1' });
		expect(single.transfer.text).toBe('NZAA');
		expect(single.embedded.title).toBe('ATIS request');
		const messages = file().map((message) => ({ ...message, label: 'H1', text: `#CFB${message.text}` }));
		expect(body(decodeLog(messages).at(-1))).toBe('NZAA');
	});
	it('accepts out-of-order segments and identical retransmissions', () => {
		const [request, first, last] = file();
		const results = decodeLog([
			request,
			{ ...last, id: 2, receivedAt: 2000 },
			{ ...first, id: 3, receivedAt: 3000 },
			{ ...first, id: 4, receivedAt: 4000 },
		]);
		expect(body(results[2])).toBe('NZAA');
		expect(body(results[3])).toBe('NZAA');
	});
	it('rejects conflicting retransmissions and excess declared length', () => {
		const [request, first, last] = file();
		const conflict = record(`${first.text}X`, 3);
		const results = decodeLog([request, first, conflict, { ...last, id: 4 }]);
		expect(results[2].interpretation.notes.join(' ')).toContain('conflicting content');
		expect(body(results[3])).toBeUndefined();
		const excess = decodeLog([record('F001000001261010235959', 1), record('S001001AB', 2)]);
		expect(excess[1].interpretation.notes.join(' ')).toContain('declared file length');
	});
	it('requires the request, every sequence number and the declared length', () => {
		const [request, first, last] = file();
		expect(body(decodeLog([first, last])[1])).toBeUndefined();
		expect(body(decodeLog([request, first])[1])).toBeUndefined();
		expect(
			body(decodeLog([request, first, { ...last, text: last.text.replace('S001002', 'S001003') }])[2]),
		).toBeUndefined();
	});
	it('separates aircraft, direction and source batches and expires old requests', () => {
		const [request, first, last] = file();
		for (const extra of [{ registration: 'OTHER' }, { direction: 'uplink' }, { receivedAt: 902000 }]) {
			expect(body(decodeLog([request, { ...first, ...extra }, { ...last, ...extra }])[2])).toBeUndefined();
		}
		decodeLog([request, first]);
		expect(body(decodeLog([last])[0])).toBeUndefined();
	});
	it('aborts transfers from the peer direction, and treats pause as control metadata', () => {
		const [request, first, last] = file();
		const aborted = decodeLog([request, first, record('A0012', 3, { direction: 'uplink' }), { ...last, id: 4 }]);
		expect(body(aborted[3])).toBeUndefined();
		const paused = decodeLog([request, first, record('YFFF', 3, { direction: 'uplink' }), { ...last, id: 4 }]);
		expect(body(paused[3])).toBe('NZAA');
	});
	it('retains complete bodies with invalid CRC without exposing or dispatching data', () => {
		const result = decodeLog(file({ corrupt: true }))[2];
		expect(result.interpretation.transfer).toBeUndefined();
		expect(result.interpretation.embedded).toBeUndefined();
		expect(result.interpretation.notes.join(' ')).toContain('CRC failed');
	});
	it('joins ACARS radio fragments before joining file segments', () => {
		const [request, first, last] = file();
		const common = { messageNumber: 'M01A', continuation: true };
		const results = decodeLog([
			request,
			{ ...first, ...common, text: first.text.slice(0, 9) },
			record(first.text.slice(9), 3, { messageNumber: 'M01B' }),
			{ ...last, id: 4, receivedAt: 4000 },
		]);
		expect(body(results[3])).toBe('NZAA');
	});
	it('bounds file storage and retains trailing payload whitespace', () => {
		const result = decodeLog(file({ compression: 0, plaintext: true, data: new TextEncoder().encode('TEXT  ') }))[2];
		expect(body(result)).toBe('TEXT  ');
		expect(decodeLog([record('F001065537261010235959', 1)])[0].interpretation.notes.join(' ')).toContain('65536');
	});
});
