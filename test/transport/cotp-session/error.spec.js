import { describe, expect, it } from 'vitest';
import { createCotpSession } from '@/framing';
import { connect, data, establish, receive, tpdu } from './wire';
const error = (reference = 11, cause = 1, parameters = [[0xc1, [6, 0xe0, 0, 0, 0, 11, 0x40]]]) =>
	tpdu([0x70, reference >> 8, reference & 255, cause], parameters);
describe('passive X.224 error-TPDU evidence', () => {
	it('releases an ER response to pending CR and quarantines its reference', () => {
		const e = createCotpSession();
		e.push(connect(), receive());
		const result = e.push(error(), receive(1, 'b-to-a'));
		expect(result.events.at(-1)).toMatchObject({
			status: 'closed',
			transportError: { cause: 1, pendingRequestReleased: true },
		});
		expect(result.packet.pdus[0].parameters[0].name).toBe('Invalid TPDU');
		expect(e.stats().frozen).toBe(1);
		expect(e.push(connect(), receive(2)).events[0].status).toBe('failed');
	});
	it('retains established connection on ER and reports raw rejected header', () => {
		const e = createCotpSession();
		establish(e);
		expect(e.push(error(), receive(1, 'b-to-a')).events[0]).toMatchObject({
			status: 'ignored',
			transportError: { pendingRequestReleased: false },
		});
		expect(e.push(data(), receive(2)).assemblies[0].status).toBe('complete');
	});
	it('isolates references/directions/sources and rejects invalid/checksum-failed errors', () => {
		const e = createCotpSession();
		establish(e);
		for (const r of [receive(1), receive(1, 'b-to-a', 'other')])
			expect(e.push(error(), r).events[0].status).toBe('ignored');
		for (const bytes of [error(11, 4), error(11, 0, [[0xc1, []]]), error(11, 0, [[0xf0, [1]]])])
			expect(e.push(bytes, receive(1, 'b-to-a')).events[0].status).toBe('failed');
		const bad = error();
		bad[bad.length - 1] ^= 1;
		expect(e.push(bad, receive(1, 'b-to-a')).events[0].status).toBe('failed');
		expect(e.stats().established).toBe(1);
	});
});
