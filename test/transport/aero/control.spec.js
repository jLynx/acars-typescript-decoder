import { describe, expect, it } from 'vitest';
import { decodeAeroSignalUnit, createAeroReassembler } from '@/framing';
function frame(body) {
	let value = 65535;
	for (const byte of body)
		for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value ^ (byte >>> i)) & 1 ? 0x8408 : 0);
	value ^= 65535;
	return Uint8Array.from([...body, value & 255, value >>> 8]);
}
describe('Aero signal-unit discriminator and control fields', () => {
	it('does not decode an R control as ACARS data without the user-data flag', () => {
		const bytes = frame([0x11, 0x23, 0x62, ...new Array(14).fill(0)]);
		const unit = decodeAeroSignalUnit(bytes, 'R');
		expect(unit).toMatchObject({ type: 0x62, typeName: 'ACK', integrity: 'verified' });
		expect(unit.sequence).toBeUndefined();
		expect(createAeroReassembler().push(bytes, 'R', { link: 'a', direction: 'downlink', receivedAt: 0 }).status).toBe(
			'ignored',
		);
	});
	it.each([0x31, 0x32, 0x33, 0x34])('decodes C-channel assignment %i in Hz with independent channel values', (type) => {
		const unit = decodeAeroSignalUnit(frame([type, 0xab, 0xcd, 0xef, 5, 0, 0x81, 0, 0, 2]), 'P');
		expect(unit.control).toMatchObject({
			aircraft: 0xabcdef,
			groundStation: 5,
			frequencies: [
				{ frequency: 1510640000, unit: 'Hz', spotBeam: true },
				{ frequency: 1611505000, unit: 'Hz', spotBeam: false },
			],
		});
	});
	it('reads channel-control bitrate codes without inventing unknown rates', () => {
		for (const [code, rate] of [
			[0, 600],
			[6, 10500],
			[9, 21000],
			[8, undefined],
		]) {
			const unit = decodeAeroSignalUnit(frame([0x40, 0, 0, 0, 5, 0, 0, code << 4, 0, 1]), 'P');
			expect(unit.control.bitRate).toBe(rate);
			expect(unit.control.frequencies[0].frequency).toBe(1510002500);
		}
	});
	it('reads satellite and GES channel broadcasts and withholds fields on CRC failure', () => {
		const sat = decodeAeroSignalUnit(frame([12, 0, 0x17, 0x20, 0, 200, 0x80, 1, 0, 0]), 'P').control;
		expect(sat).toMatchObject({
			sequence: 5,
			satellite: 50,
			longitude: -60,
			longitudeUnit: 'deg',
			frequencies: [{ frequency: 1510002500, spotBeam: true }],
		});
		expect(sat.frequencies).toHaveLength(1);
		const ges = frame([5, 0, 0x14, 5, 0, 1, 0, 2, 0, 3]);
		expect(decodeAeroSignalUnit(ges, 'P').control.frequencies.map((p) => p.frequency)).toEqual([
			1510002500, 1611505000, 1611507500,
		]);
		ges[5] ^= 1;
		expect(decodeAeroSignalUnit(ges, 'P').control).toBeUndefined();
	});
});
