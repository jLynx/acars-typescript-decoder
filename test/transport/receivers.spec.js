import { describe, expect, it } from 'vitest';
import { adaptReceiverRecord, createDecoderSession } from '@/index';

describe('receiver JSON adapters', () => {
	it('maps flat receiver fields without changing raw text or inferring checksum success', () => {
		const raw = {
			timestamp: 1791576000.125,
			station_id: 'test',
			channel: 2,
			label: 'H1',
			text: 'TEXT  ',
			tail: 'ZK-NZE',
			block_id: '1',
			msgno: 'M01A',
			flight: 'ANZ001',
			end: 'ETB',
			err: 3,
		};
		const result = adaptReceiverRecord(raw);
		expect(result).toMatchObject({
			source: 'acars:test:2',
			errors: 3,
			message: {
				text: 'TEXT  ',
				receivedAt: 1791576000125,
				registration: 'ZK-NZE',
				continuation: true,
				direction: 'downlink',
				messageNumber: 'M01A',
			},
			raw,
		});
		result.raw.text = 'changed';
		expect(raw.text).toBe('TEXT  ');
	});
	it.each(['vdl2', 'hfdl'])('extracts %s nested application records and microsecond timestamps', (type) => {
		const raw = {
			[type]: {
				t: { sec: 1791576000, usec: 123000 },
				freq: 136975000,
				avlc: { acars: { reg: 'ZK-NZE', label: '5D', txt: 'NZAA', block_id: 'A' } },
			},
		};
		const result = adaptReceiverRecord(raw);
		expect(result.message).toMatchObject({ label: '5D', text: 'NZAA', direction: 'uplink', receivedAt: 1791576000123 });
		expect(createDecoderSession().push(result.message, result.source).text).toBe('NZAA');
	});
	it('returns undefined for unsupported shapes and terminates cyclic object traversal', () => {
		for (const input of [null, [], {}, { label: 'X', text: 'bad' }]) expect(adaptReceiverRecord(input)).toBeUndefined();
		const cycle = {};
		cycle.data = cycle;
		expect(adaptReceiverRecord(cycle)).toBeUndefined();
	});
	it.each(['downlink', 'uplink'])('reconstructs receiver-stripped H1 metadata for %s dispatch', (direction) => {
		const raw = {
			hfdl: {
				t: { sec: 1, usec: 0 },
				lpdu: {
					acars: {
						label: 'H1',
						msg_text: 'TEXT  ',
						sublabel: 'DF',
						mfi: 'AB',
						msg_dir: direction,
						blk_id: direction === 'uplink' ? 'A' : '1',
						msg_num: 'M01',
						msg_num_seq: 'B',
					},
				},
			},
		};
		const result = adaptReceiverRecord(raw);
		expect(result.message.text).toBe(`${direction === 'uplink' ? '- #DF' : '#DFB'}/AB TEXT  `);
		expect(result.message.messageNumber).toBe('M01B');
		expect(result.raw.hfdl.lpdu.acars.msg_text).toBe('TEXT  ');
	});
});
