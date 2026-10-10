import { describe, expect, it } from 'vitest';
import { decodeLog, createDecoderSession } from '@/index';

const block = (id, blockId, text, continuation = false, extra = {}) => ({
	id,
	receivedAt: id * 1000,
	blockId,
	text,
	continuation,
	label: 'ZZ',
	registration: 'ZK-NZE',
	mode: '2',
	direction: 'uplink',
	...extra,
});

describe('uplink ACARS link block assembly', () => {
	it('starts with any ETB block and wraps X to A, preserving original text', () => {
		const results = decodeLog([block(1, 'W', 'ONE ', true), block(2, 'X', 'TWO ', true), block(3, 'A', 'THREE')]);
		expect(results[2]).toMatchObject({ text: 'THREE', assembledText: 'ONE TWO THREE' });
	});
	it('accepts identical radio retransmissions and retains complete final retransmissions', () => {
		const results = decodeLog([
			block(1, 'A', 'ONE ', true),
			block(2, 'A', 'ONE ', true),
			block(3, 'B', 'TWO'),
			block(4, 'B', 'TWO'),
		]);
		expect(results[2].assembledText).toBe('ONE TWO');
		expect(results[3].assembledText).toBe('ONE TWO');
	});
	it('rejects missing link blocks and expired chains', () => {
		for (const final of [block(2, 'C', 'TWO'), block(2, 'B', 'TWO', false, { receivedAt: 92000 })]) {
			const result = decodeLog([block(1, 'A', 'ONE ', true), final])[1];
			expect(result.assembledText).toBeUndefined();
			expect(result.interpretation.notes.join(' ')).toContain('Reassembly unavailable:');
		}
	});
	it('keeps direction, aircraft and label isolated; empty ACKs cannot finish text', () => {
		const initial = block(1, 'A', 'ONE ', true);
		for (const extra of [{ registration: 'OTHER' }, { label: '_d' }, { direction: 'downlink' }])
			expect(decodeLog([initial, block(2, 'B', 'TWO', false, extra)])[1].assembledText).toBeUndefined();
	});
	it('removes repeated matching H1 envelopes and rejects conflicting sublabels', () => {
		const initial = block(1, 'A', '- #MD/AA ONE ', true, { label: 'H1' });
		expect(decodeLog([initial, block(2, 'B', '- #MD/AA TWO', false, { label: 'H1' })])[1].assembledText).toBe(
			'- #MD/AA ONE TWO',
		);
		expect(decodeLog([initial, block(2, 'B', '- #CF TWO', false, { label: 'H1' })])[1].assembledText).toBeUndefined();
	});
	it('joins uplinks across streaming calls', () => {
		const session = createDecoderSession();
		session.push(block(1, 'D', 'ONE ', true));
		expect(session.push(block(2, 'E', 'TWO')).assembledText).toBe('ONE TWO');
	});
});
