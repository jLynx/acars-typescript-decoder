import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decode, createDecoder } from '@/index';
import { airportName } from '@/airports';
import fixture from './fixture.json';

const inner = {
	clientId: 'OHMA',
	messageDate: '2026-10-10T08:00:00Z',
	data: {
		airplanes: [
			{
				tailNumber: 'ZK-TEST',
				model: '737',
				flights: [
					{
						departureAirportCode: 'NZAA',
						arrivalAirportCode: 'NZCH',
						flightNumber: 'TEST1',
						events: [{ eventType: 'TEST_EVENT', instances: [{ name: 'NAMED_PARAMETER', values: [123.5] }] }],
					},
				],
			},
		],
	},
};
const encoded = (outer) => deflateSync(JSON.stringify(outer)).toString('base64');
const outer = (extra = {}) => ({ version: '2.0', message: JSON.stringify(inner), ...extra });
const parse = (text, extra = {}) => decode({ label: 'H1', text, ...extra });

describe('Boeing OHMA/RYKO compressed JSON', () => {
	it.each(['OHMA', 'RYKO', '/RTNBOCR.OHMA', '/O2.OHMA', '#T1BOHMA'])('decodes supported prefix %s', (prefix) => {
		const result = parse(prefix + encoded(outer()));
		expect(result.fields).toContainEqual({ label: 'NAMED_PARAMETER', value: '[123.5]' });
		expect(result.fields).toContainEqual({ label: 'Flight', value: 'TEST1' });
		expect(result.coverage).toBe('partial');
	});
	it('enriches airport fields while retaining the original JSON', () => {
		const result = createDecoder({ airportLookup: airportName }).decode({
			label: 'H1',
			text: 'OHMA' + encoded(outer()),
		});
		expect(result.fields).toContainEqual({ label: 'Departure', value: 'NZAA · Auckland International Airport' });
		expect(result.fields.find((f) => f.label === 'Application JSON').value).toBe(JSON.stringify(inner));
	});
	it('matches the pinned MIT Rust fixture including named numeric values', () => {
		const result = parse(fixture);
		expect(result.fields).toContainEqual({ label: 'tailNumber', value: 'OK-SWN' });
		expect(result.fields).toContainEqual({ label: 'Flight', value: 'TVS1BC' });
		expect(JSON.parse(result.fields.find((f) => f.label === 'TM1TEMP1_MED').value)[0]).toBeCloseTo(330.322);
	});
	it.each([
		['OHMA!', {}],
		['OHMA' + encoded({}), {}],
		['OHMA' + encoded(outer({ message: 'not JSON' })), {}],
		['OHMA' + encoded(outer({ message: '{}' })), {}],
		['OHMA' + encoded(outer({ msg_total: 2, msg_seq: 1, convo_id: 'test' })), {}],
		['OHMA' + encoded(outer({ sym_key: 'secret' })), {}],
		['OHMA' + encoded(outer()), { continuation: true }],
	])('preserves unsupported or invalid body %s', (text, extra) => {
		const result = parse(text, extra);
		expect(result.fields.some((f) => f.label === 'Application JSON')).toBe(false);
		expect(result.notes.length).toBeGreaterThan(0);
	});
	it('rejects truncated, trailing and oversized zlib streams', () => {
		const compressed = deflateSync(JSON.stringify(outer()));
		for (const data of [
			compressed.subarray(0, -1),
			Buffer.concat([compressed, Buffer.from([1, 2])]),
			deflateSync('x'.repeat(65537)),
		]) {
			const result = parse('OHMA' + data.toString('base64'));
			expect(result.fields.some((f) => f.label === 'Application JSON')).toBe(false);
		}
	});
});
