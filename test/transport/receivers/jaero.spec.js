import { describe, expect, it } from 'vitest';
import { adaptReceiverRecord, createDecoderSession } from '@/index';
describe('JAERO native and JSONdump receiver records', () => {
	it('preserves native text, station metadata and epoch time without inventing continuation', () => {
		const raw = {
			TIME: 1791576000,
			NAME: 'JAERO',
			NONACARS: false,
			AESID: 'ABCDEF',
			GESID: '05',
			REG: 'ZK-NZE',
			MODE: '2',
			TAK: '!',
			LABEL: 'H1',
			BI: 'A',
			MESSAGE: 'TEXT\n\t ',
			FLIGHT: 'TEST01',
		};
		const record = adaptReceiverRecord(raw);
		expect(record).toMatchObject({
			source: 'aero:JAERO:05',
			message: {
				label: 'H1',
				text: 'TEXT\n\t ',
				registration: 'ZK-NZE',
				receivedAt: 1791576000000,
				continuation: false,
			},
		});
		expect(record.raw).toEqual(raw);
		expect(record.message.direction).toBeUndefined();
		record.raw.MESSAGE = 'changed';
		expect(raw.MESSAGE).toBe('TEXT\n\t ');
	});
	it('uses JSONdump source direction even with a conflicting block identifier', () => {
		for (const [type, expected] of [
			['Aircraft Earth Station', 'downlink'],
			['Ground Earth Station', 'uplink'],
		]) {
			const record = adaptReceiverRecord({
				isu: { src: { type }, acars: { label: '5D', msg_text: 'NZAA', blk_id: 'A' } },
			});
			expect(record.message.direction).toBe(expected);
		}
	});
	it('accepts native and JSONdump empty-text acknowledgements from documented emitters', () => {
		const native = adaptReceiverRecord({ LABEL: '_d', MODE: '2', TAK: '!', BI: 'A', REG: 'ZK-NZE' });
		expect(native.message.text).toBe('');
		expect(native.message.direction).toBeUndefined();
		const nested = adaptReceiverRecord({
			isu: { src: { type: 'Aircraft Earth Station' }, acars: { label: '_d', mode: '2', ack: '!', blk_id: 'A' } },
		});
		expect(nested.message).toMatchObject({ text: '', direction: 'downlink' });
	});
	it('finds JSONdump ISU records and keeps all nested transport metadata for replay', () => {
		const raw = {
			app: { name: 'JAERO', ver: '1.0' },
			t: { sec: 1, usec: 12000 },
			station: 'test',
			isu: {
				src: { type: 'Aircraft Earth Station', addr: 'ABCDEF' },
				dst: { type: 'Ground Earth Station', addr: '05' },
				qno: '02',
				refno: '03',
				acars: { label: '5D', msg_text: 'NZAA', reg: 'ZK-NZE', blk_id: '1' },
			},
		};
		const record = adaptReceiverRecord(raw);
		expect(record.message.receivedAt).toBe(1012);
		expect(record.source).toBe('aero:test:');
		expect(record.raw.isu.src.addr).toBe('ABCDEF');
		expect(createDecoderSession().push(record.message, record.source).text).toBe('NZAA');
	});
	it('rejects non-ACARS/invalid records and malformed timestamps remain absent', () => {
		expect(adaptReceiverRecord({ NONACARS: true, LABEL: 'H1', MESSAGE: 'data' })).toBeUndefined();
		expect(adaptReceiverRecord({ LABEL: 'H1' })).toBeUndefined();
		for (const t of [
			{ sec: NaN, usec: 0 },
			{ sec: 1, usec: Infinity },
			{ sec: 1, usec: -1 },
			{ sec: 1, usec: 1000000 },
		])
			expect(
				adaptReceiverRecord({ t, isu: { acars: { label: 'H1', msg_text: 'test' } } }).message.receivedAt,
			).toBeUndefined();
	});
});
