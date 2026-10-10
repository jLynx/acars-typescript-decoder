import { describe, expect, it } from 'vitest';
import { decodeAtnB2Structure } from '@/index';
import { find } from './wire';

// Hand-packed from the pinned generated member/constraint tables, independent of schema.json.
const int = (value, width) => value.toString(2).padStart(width, '0');
function decode(binary, options) {
	const bytes = Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g), (b) =>
		parseInt(b, 2),
	);
	return decodeAtnB2Structure(bytes, { ...options, bitLength: binary.length });
}
const cpdlc = { application: 'cpdlc', mode: 'application', direction: 'uplink' };
const adsc = { application: 'adsc', mode: 'application', direction: 'uplink', message: 'request' };
const header = (optional = '00') =>
	optional + int(17, 6) + int(2026 - 1996, 7) + int(9, 4) + int(9, 5) + int(12, 5) + int(34, 6) + int(56, 6);

describe('independent B2 CPDLC and ADS-C v2 structures', () => {
	it('reads uplink header values and default logical acknowledgement', () => {
		const result = decode(header() + '0' + '000' + '0' + int(0, 8), cpdlc);
		expect(find(result.value, 'MsgIdentificationNumber').value).toBe(17);
		expect(find(result.value, 'Year').value).toBe(2026);
		expect(find(result.value, 'Month').value).toBe(10);
		expect(find(result.value, 'Day').value).toBe(10);
		expect(find(result.value, 'Timehours').value).toBe(12);
		expect(find(result.value, 'Timeminutes').value).toBe(34);
		expect(find(result.value, 'TimeSeconds').value).toBe(56);
		expect(find(result.value, 'LogicalAck')).toMatchObject({
			value: 1,
			enumeration: 'notRequired',
			defaulted: true,
			bitLength: 0,
		});
		expect(find(result.value, 'ATCUplinkMsgElementId').choice).toBe('uM0NULL');
		expect(result).toMatchObject({ structureComplete: true, integrity: 'unverified' });
	});
	it('reads explicitly required logical acknowledgement', () => {
		const result = decode(header('01') + '0' + '0' + '000' + '0' + int(0, 8), cpdlc);
		expect(find(result.value, 'LogicalAck')).toMatchObject({ value: 0, enumeration: 'required' });
		expect(find(result.value, 'LogicalAck').defaulted).toBeUndefined();
	});
	it('reads late uplink extension 185 with a large normally-small index', () => {
		const result = decode(header() + '0' + '000' + '1' + '1' + int(1, 8) + int(185, 8) + int(1, 8) + int(0, 8), cpdlc);
		expect(find(result.value, 'ATCUplinkMsgElementId')).toMatchObject({ choice: 'uM344', choiceIndex: 423 });
		expect(result.structureComplete).toBe(true);
	});
	it('retains unknown extension payloads', () => {
		const result = decode(
			header() + '0' + '000' + '1' + '1' + int(1, 8) + int(186, 8) + int(2, 8) + int(0xaabb, 16),
			cpdlc,
		);
		const value = find(result.value, 'ATCUplinkMsgElementId');
		expect(value.extensions[0].payload).toEqual(Uint8Array.of(0xaa, 0xbb));
		expect(value.extensions[0].value).toBeUndefined();
		expect(result.notes.join(' ')).toContain('Unsupported extension');
	});
	it('reads a demand request without confusing it with cancellation', () => {
		const result = decode('00' + '0' + '0000000' + int(73, 8), adsc);
		expect(result.value.choice).toBe('demand-contract');
		expect(find(result.value, 'ContractNumber').value).toBe(73);
		expect(result.structureComplete).toBe(true);
	});
	it('reads a demand request extension bitmap with two known NULL fields', () => {
		const result = decode(
			'00' + '1' + '0000000' + int(73, 8) + '0' + int(1, 6) + '11' + int(1, 8) + int(0, 8) + int(1, 8) + int(0, 8),
			adsc,
		);
		const extensions = find(result.value, 'DemandContractRequest').extensions;
		expect(extensions.map((e) => e.value.name)).toEqual(['rnp-profile', 'planned-final-approach-speed']);
		expect(result.structureComplete).toBe(true);
	});
	it.each([
		[0, 59, 6, 'ReportingRate__reporting_time_seconds_scale'],
		[1, 120, 7, 'ReportingRate__reporting_time_minutes_scale'],
	])('reads periodic reporting choice %i with explicit scale', (choice, value, width, type) => {
		const result = decode('10' + '0' + '0000000' + int(255, 8) + int(choice, 1) + int(value - 1, width), adsc);
		expect(result.value.choice).toBe('periodic-contract');
		expect(find(result.value, type).value).toBe(value);
		expect(find(result.value, 'ContractNumber').value).toBe(255);
	});
	it('reads acknowledgement request type and empty ATSU list', () => {
		const result = decode('00' + int(73, 8) + '0' + '10' + '000', {
			...adsc,
			direction: 'downlink',
			message: 'positiveAcknowledgement',
		});
		expect(find(result.value, 'ADSv2RequestType')).toMatchObject({ value: 2, enumeration: 'demand-contract' });
		expect(find(result.value, 'ConnectedATSUList').children).toEqual([]);
		expect(result.structureComplete).toBe(true);
	});
	it.each([
		{},
		{ ...adsc, message: undefined },
		{ ...adsc, message: 'report' },
		{ ...cpdlc, message: 'report' },
		{ ...adsc, message: 'bogus' },
	])('requires an explicit matching application input %j', (options) => {
		expect(() => decode('00000000', options)).toThrow();
	});
	it('rejects incorrect extension padding and impossible seconds', () => {
		expect(() =>
			decode(header() + '0' + '000' + '1' + '1' + int(1, 8) + int(185, 8) + int(1, 8) + '00000001', cpdlc),
		).toThrow();
		expect(() => decode(header().slice(0, -6) + '111111' + '0' + '000' + '0' + int(0, 8), cpdlc)).toThrow();
	});
});
