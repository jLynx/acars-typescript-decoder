// Aero control fields adapted from MIT JAERO aerol.cpp/h (pinned in docs/upstreams.json).
import type { AeroSignalUnit, AeroControl } from './types';

const pNames: Record<number, string> = {
	0: 'Reserved',
	1: 'Fill',
	5: 'GES channel broadcast',
	7: 'GES beam broadcast',
	10: 'System table index',
	12: 'Satellite identification',
	16: 'Logon request',
	17: 'Logon confirm',
	18: 'Logoff request',
	19: 'Logon reject',
	20: 'Logon interrogation',
	21: 'Logon/logoff ACK',
	22: 'Logon prompt',
	23: 'Channel reassignment',
	33: 'Call announcement',
	40: 'Data EIRP table',
	48: 'Call progress',
	49: 'Distress C-channel assignment',
	50: 'Flight safety C-channel assignment',
	51: 'Other safety C-channel assignment',
	52: 'Non-safety C-channel assignment',
	64: 'P/R channel control',
	65: 'T channel control',
	81: 'T channel assignment',
	97: 'Request ACK',
	98: 'ACK',
	116: 'Three-octet user data',
	118: 'Four-octet user data',
};
const rNames: Record<number, string> = {
	0x20: 'Telephone general access',
	0x23: 'Telephone abbreviated access',
	0x22: 'Data access',
	0x61: 'Request ACK',
	0x62: 'ACK',
	0x12: 'Logon/logoff control',
	0x30: 'Call progress',
	0x15: 'Logon/logoff ACK',
	0x17: 'Ready for reassignment',
	0x60: 'Telephony ACK',
};
const channel = (bytes: Uint8Array, offset: number, base: number, masked = true) =>
	base + ((masked ? bytes[offset] & 127 : bytes[offset]) * 256 + bytes[offset + 1]) * 2500;

export function readAeroControl(result: AeroSignalUnit): void {
	const bytes = result.raw;
	if (result.channel === 'R') {
		result.typeName = rNames[result.type] ?? 'Unknown control';
		result.control = { raw: bytes.slice(0, -2) };
		return;
	}
	result.typeName = pNames[result.type] ?? 'Unknown control';
	const control: AeroControl = { raw: bytes.slice(0, -2) };
	if ([0x31, 0x32, 0x33, 0x34].includes(result.type)) {
		control.aircraft = bytes[1] * 65536 + bytes[2] * 256 + bytes[3];
		control.groundStation = bytes[4];
		control.frequencies = [frequency(bytes, 6, 1510000000, 'receive'), frequency(bytes, 8, 1611500000, 'transmit')];
	} else if (result.type === 0x40) {
		control.groundStation = bytes[4];
		control.bitRateCode = bytes[7] >>> 4;
		control.bitRate = [600, 1200, 2400, 4800, 6000, 5250, 10500, 8400, undefined, 21000][control.bitRateCode];
		control.bitRateUnit = 'bit/s';
		control.frequencies = [frequency(bytes, 8, 1510000000, 'P data')];
	} else if (result.type === 5) {
		control.sequence = bytes[2] >>> 2;
		control.groundStation = bytes[3];
		const index = bytes[2] & 3;
		control.frequencies = [4, 6, 8].map((offset, i) => ({
			role: index < 2 && i === 0 ? 'P signalling' : `R signalling ${index < 2 ? i - 1 : (index - 2) * 3 + 2 + i}`,
			frequency: channel(bytes, offset, index < 2 && i === 0 ? 1510000000 : 1611500000, false),
			unit: 'Hz' as const,
		}));
	} else if (result.type === 12) {
		control.sequence = bytes[2] >>> 2;
		control.satellite = ((bytes[2] & 3) << 4) | (bytes[3] >>> 4);
		const longitude = bytes[5] * 1.5;
		control.longitude = longitude > 180 ? longitude - 360 : longitude;
		control.longitudeUnit = 'deg';
		control.frequencies = [frequency(bytes, 6, 1510000000, 'P signalling 1')];
		if (bytes[8] & 127 || bytes[9]) control.frequencies.push(frequency(bytes, 8, 1510000000, 'P signalling 2'));
	}
	result.control = control;
}

function frequency(
	bytes: Uint8Array,
	offset: number,
	base: number,
	role: string,
): NonNullable<AeroControl['frequencies']>[number] {
	return { role, frequency: channel(bytes, offset, base), unit: 'Hz', spotBeam: Boolean(bytes[offset] & 128) };
}
