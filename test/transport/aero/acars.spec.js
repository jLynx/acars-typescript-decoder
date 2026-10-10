import { describe, expect, it } from 'vitest';
import { decodeAeroAcars } from '@/transport/aero/acars';
import { parity, payload, wireBytes } from '../../framing/fixtures';
const wrap = (body) => Uint8Array.from([255, 255, 1, ...wireBytes(body).slice(3)]);
describe('Aero ACARS envelope separate from VHF text headers', () => {
	it.each(['uplink', 'downlink'])(
		'uses known %s direction and retains all text for letter/digit block IDs',
		(direction) => {
			for (const id of ['A', '1']) {
				const frame = payload('body', 'A');
				frame[11] = parity(id.charCodeAt(0));
				expect(decodeAeroAcars(wrap(frame), direction)).toMatchObject({
					direction,
					blockId: id,
					text: 'body',
					label: 'H1',
				});
				expect(decodeAeroAcars(wrap(frame), direction).messageNumber).toBeUndefined();
			}
		},
	);
	it('accepts empty-text ACK and continuation and rejects BCS/parity/SOH/truncation errors', () => {
		const ack = Uint8Array.from([...`2.ZK-NZE${String.fromCharCode(21)}_dA${String.fromCharCode(3)}`], (c) =>
			parity(c.charCodeAt(0)),
		);
		expect(decodeAeroAcars(wrap(ack), 'downlink')).toMatchObject({ text: '', acknowledgement: 'NAK' });
		expect(decodeAeroAcars(wrap(payload('body', 'A', 23)), 'downlink').continuation).toBe(true);
		const good = wrap(payload('body', 'A'));
		for (const offset of [0, 2, 8, good.length - 2, good.length - 1]) {
			const bad = good.slice();
			bad[offset] ^= 1;
			expect(decodeAeroAcars(bad, 'downlink')).toBeUndefined();
		}
		for (let i = 0; i < good.length; i++) expect(decodeAeroAcars(good.slice(0, i), 'downlink')).toBeUndefined();
	});
});
