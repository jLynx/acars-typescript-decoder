import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { createDecoder } from '@/index';
import { airportName } from '@/airports';

const decoder = createDecoder({ airportLookup: airportName });
const application = JSON.stringify({
	data: {
		airplanes: [
			{
				tailNumber: 'ZK-TEST',
				flights: [{ departureAirportCode: 'NZAA', arrivalAirportCode: 'NZCH', flightNumber: 'TEST1' }],
			},
		],
	},
});
const part = (id, sequence, text, extra = {}) => ({
	id,
	receivedAt: Date.parse('2026-10-10T05:00:00Z') + id * 1000,
	registration: 'ZK-TEST',
	mode: '2',
	acknowledgement: 'NAK',
	label: 'H1',
	blockId: String(id),
	direction: 'downlink',
	messageNumber: `M${String(id).padStart(2, '0')}A`,
	flight: 'TEST1',
	continuation: false,
	text:
		'OHMA' +
		deflateSync(
			JSON.stringify({
				version: '2.0',
				convo_id: 'test',
				msg_seq: sequence,
				message: text,
				...(sequence === 1 ? { msg_total: 2 } : {}),
				...extra,
			}),
		).toString('base64'),
});
const halves = () => [part(1, 1, application.slice(0, 50)), part(2, 2, application.slice(50))];
const json = (record) => record.interpretation.fields.find((f) => f.label === 'Application JSON')?.value;

describe('OHMA conversation reassembly independent of ACARS blocks', () => {
	it('joins verified one-based parts even when later parts omit msg_total', () => {
		const input = halves();
		const results = decoder.decodeLog(input);
		expect(json(results[0])).toBeUndefined();
		expect(json(results[1])).toBe(application);
		expect(results[1].interpretation.fields).toContainEqual({
			label: 'Destination',
			value: 'NZCH · Christchurch International Airport',
		});
		expect(results.map((m) => m.text)).toEqual(input.map((m) => m.text));
	});
	it('accepts out-of-order parts and identical final retransmissions', () => {
		const [first, last] = halves();
		expect(
			json(
				decoder
					.decodeLog([
						{ ...last, receivedAt: first.receivedAt },
						{ ...first, receivedAt: last.receivedAt },
					])
					.at(-1),
			),
		).toBe(application);
		expect(json(decoder.decodeLog([first, last, { ...last, id: 3, receivedAt: last.receivedAt + 1000 }]).at(-1))).toBe(
			application,
		);
	});
	it.each([
		{ registration: 'OTHER' },
		{ mode: '1' },
		{ direction: 'uplink' },
		{ flight: 'OTHER' },
		{ receivedAt: Date.parse('2026-10-10T05:21:00Z') },
	])('does not combine incompatible or expired conversations %s', (extra) => {
		const [first, last] = halves();
		expect(json(decoder.decodeLog([first, { ...last, ...extra }]).at(-1))).toBeUndefined();
	});
	it('keeps separate sources isolated and requires the first part', () => {
		const [first, last] = halves();
		decoder.decodeLog([first]);
		expect(json(decoder.decodeLog([last])[0])).toBeUndefined();
	});
	it('rejects conflicting counts and conflicting repeated content', () => {
		const [first, last] = halves();
		expect(
			json(decoder.decodeLog([first, part(2, 2, application.slice(50), { msg_total: 3 })]).at(-1)),
		).toBeUndefined();
		const results = decoder.decodeLog([first, part(2, 1, 'different'), { ...last, id: 3 }]);
		expect(json(results.at(-1))).toBeUndefined();
		expect(results[1].interpretation.notes.join(' ')).toContain('conflicting content');
		const restarted = decoder.decodeLog([first, part(2, 1, 'different'), { ...first, id: 3 }, { ...last, id: 4 }]);
		expect(json(restarted.at(-1))).toBeUndefined();
		expect(restarted.at(-1).interpretation.notes.join(' ')).toContain('conflicting content');
	});
	it('refuses encrypted parts, invalid part IDs and invalid completed JSON', () => {
		const [first] = halves();
		for (const extra of [{ sym_key: 'x' }, { msg_seq: 0 }, { msg_seq: 257 }, { version: '3' }])
			expect(json(decoder.decodeLog([first, part(2, 2, application.slice(50), extra)]).at(-1))).toBeUndefined();
		const results = decoder.decodeLog([part(1, 1, '{'), part(2, 2, 'invalid}')]);
		expect(json(results.at(-1))).toBeUndefined();
		expect(results.at(-1).interpretation.notes.join(' ')).toContain('invalid or unsupported');
	});
});
