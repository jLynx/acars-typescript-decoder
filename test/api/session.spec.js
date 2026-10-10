import { describe, expect, it } from 'vitest';
import { createDecoderSession } from '@/index';
import { transfer } from '../payload/protocols/miam-fixtures';
import { deflateSync } from 'node:zlib';

const message = (text, extra = {}) => ({
	label: 'ZZ',
	text,
	registration: 'ZK-NZE',
	mode: '2',
	receivedAt: 1000,
	...extra,
});

describe('source-isolated bounded decoder sessions', () => {
	it('assigns IDs, joins consecutive blocks and returns independent results', () => {
		const session = createDecoderSession();
		const first = session.push(message('ONE ', { messageNumber: 'M01A', continuation: true }));
		first.text = 'mutated';
		const final = session.push(message('TWO', { messageNumber: 'M01B', receivedAt: 2000 }));
		expect(final).toMatchObject({ id: 2, text: 'TWO', assembledText: 'ONE TWO' });
	});
	it('keeps channels separate and clears a requested source', () => {
		const session = createDecoderSession();
		session.push(message('ONE ', { messageNumber: 'M01A', continuation: true }), 'vhf');
		expect(
			session.push(message('TWO', { messageNumber: 'M01B', receivedAt: 2000 }), 'satcom').assembledText,
		).toBeUndefined();
		session.reset('vhf');
		expect(session.stats().sources).toBe(1);
		session.reset();
		expect(session.stats().records).toBe(0);
	});
	it('retains MIAM requests and OHMA parts across calls', () => {
		const session = createDecoderSession();
		const core = transfer().slice(1);
		session.push(message(`F001${String(core.length).padStart(6, '0')}261010235959`, { label: 'MA' }));
		const miam = session.push(message(`S001001${core}`, { label: 'MA', receivedAt: 2000 }));
		expect(miam.interpretation.transfer.text).toBe('NZAA');
		const text = JSON.stringify({ data: { airplanes: [] } });
		const part = (seq, data) =>
			'OHMA' +
			deflateSync(
				JSON.stringify({ version: '2', convo_id: 'test', msg_seq: seq, msg_total: 2, message: data }),
			).toString('base64');
		session.push(message(part(1, text.slice(0, 10)), { label: 'H1', receivedAt: 3000 }));
		expect(
			session.push(message(part(2, text.slice(10)), { label: 'H1', receivedAt: 4000 })).interpretation.fields,
		).toContainEqual({ label: 'Application JSON', value: text });
	});
	it('expires by reception time and bounds blocks, characters and least recently used sources', () => {
		const session = createDecoderSession({ maxSources: 2, maxRecords: 2, maxCharacters: 8, retentionMs: 1000 });
		session.push(message('12345'));
		session.push(message('67890', { receivedAt: 1500 }));
		expect(session.stats()).toMatchObject({ records: 1, characters: 5, evictedRecords: 1 });
		session.push(message('new', { receivedAt: 3000 }));
		expect(session.stats().records).toBe(1);
		session.push(message('a'), 'two');
		session.push(message('b'), 'three');
		expect(session.stats()).toMatchObject({ sources: 2, records: 2, characters: 2 });
	});
	it('rejects duplicate source IDs and invalid limits without corrupting state', () => {
		const session = createDecoderSession();
		session.push(message('one', { id: 10 }));
		expect(() => session.push(message('two', { id: 10 }))).toThrow(/unique/);
		expect(session.push(message('three')).id).toBe(11);
		for (const options of [{ maxSources: 0 }, { maxRecords: 10001 }, { maxCharacters: NaN }, { retentionMs: -1 }])
			expect(() => createDecoderSession(options)).toThrow();
	});
	it('exposes structured block states and lets callers retrieve late-completed records', () => {
		const session = createDecoderSession();
		const last = session.push(message('TWO', { messageNumber: 'M01B', receivedAt: 2000 }));
		expect(last.assemblies[0].status).toBe('failed');
		const first = session.push(message('ONE ', { messageNumber: 'M01A', continuation: true }));
		expect(first.assemblies[0].status).toBe('pending');
		const snapshot = session.snapshot();
		expect(snapshot.at(-1)).toMatchObject({
			assembledText: 'ONE TWO',
			assemblies: [{ status: 'complete', blocks: ['M01A', 'M01B'] }],
		});
		snapshot[0].text = 'mutated';
		expect(session.snapshot()[0].text).toBe('ONE ');
		expect(session.push(message('TWO', { messageNumber: 'M01B', receivedAt: 2500 })).assemblies[0].status).toBe(
			'duplicate',
		);
	});
	it('reports an expired assembly and does not retain records older than the session watermark', () => {
		const session = createDecoderSession({ retentionMs: 300000 });
		session.push(message('ONE ', { messageNumber: 'M01A', continuation: true }));
		expect(session.push(message('TWO', { messageNumber: 'M01B', receivedAt: 125000 })).assemblies[0].status).toBe(
			'expired',
		);
		session.push(message('new', { receivedAt: 500000 }));
		session.push(message('old', { receivedAt: 1000 }));
		expect(session.snapshot().map((record) => record.text)).toEqual(['new']);
	});
});
