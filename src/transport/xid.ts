// Adapted from MIT xoolive/datalink xid.rs, pinned in docs/upstreams.json.
import { decodeAvlcAddress } from './address';
import type { XidFrequency, XidLocation, XidMessage, XidParameter } from './types';

const names = [
	['Unknown', 'Unknown XID type'],
	['LCR', 'Link Connection Refused'],
	['HO', 'Handoff Request / Broadcast Handoff'],
	['GSIF', 'Ground Station Information Frame'],
	['LE', 'Link Establishment'],
	['Unknown', 'Unknown XID type'],
	['HO', 'Handoff Initiation'],
	['LPM', 'Link Parameter Modification'],
	['Unknown', 'Unknown XID type'],
	['Unknown', 'Unknown XID type'],
	['Unknown', 'Unknown XID type'],
	['Unknown', 'Unknown XID type'],
	['LE response', 'Link Establishment Response'],
	['LCR response', 'Link Connection Refused Response'],
	['HO response', 'Handoff Response'],
	['LPM response', 'Link Parameter Modification Response'],
];

/** XID information bytes, without AVLC header/FCS. Link C/R and P/F select the message type. */
export function decodeXid(bytes: Uint8Array, response = false, pollFinal = false): XidMessage | undefined {
	if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes.length > 8192 || bytes[0] !== 0x82) return;
	const result: XidMessage = {
		protocol: 'XID',
		type: 'Unknown',
		description: 'Unknown XID type',
		coverage: 'decoded',
		raw: bytes.slice(),
		groups: [],
		notes: [],
	};
	let position = 1;
	while (position < bytes.length) {
		if (position + 3 > bytes.length) return;
		const id = bytes[position];
		const length = bytes[position + 1] * 256 + bytes[position + 2];
		position += 3;
		if (position + length > bytes.length || result.groups.some((group) => group.id === id)) return;
		const parameters = readParameters(bytes.subarray(position, position + length), id);
		if (!parameters) return;
		result.groups.push({ id, parameters });
		position += length;
		if (id !== 0x80 && id !== 0xf0) result.coverage = 'partial';
	}
	const privateGroup = result.groups.find((group) => group.id === 0xf0);
	if (!privateGroup) return;
	const connection = privateGroup.parameters.find((parameter) => parameter.id === 1)?.raw;
	const hr = connection?.length === 1 ? connection[0] & 3 : 3;
	const [type, description] = names[Number(response) * 8 + Number(pollFinal) * 4 + hr];
	result.type = type;
	result.description = description;
	if (type === 'Unknown' || result.groups.some((group) => group.parameters.some((p) => p.value === undefined))) {
		result.coverage = 'partial';
		result.notes.push('Unsupported parameter values are retained as raw bytes.');
	}
	return result;
}

function readParameters(bytes: Uint8Array, group: number): XidParameter[] | undefined {
	const parameters: XidParameter[] = [];
	let position = 0;
	while (position < bytes.length) {
		if (position + 2 > bytes.length) return;
		const id = bytes[position++],
			length = bytes[position++];
		if (position + length > bytes.length || parameters.some((parameter) => parameter.id === id)) return;
		const raw = bytes.slice(position, position + length);
		parameters.push(parameter(group, id, raw));
		position += length;
	}
	return parameters;
}

function parameter(group: number, id: number, raw: Uint8Array): XidParameter {
	const publicNames: Record<number, string> = { 1: 'Parameter set', 2: 'Procedure classes', 3: 'HDLC options' };
	const privateNames: Record<number, string> = {
		0: 'Parameter set',
		1: 'Connection management',
		4: 'AVLC options',
		0x42: 'T4 timer (raw)',
		0x83: 'Destination airport',
		0x84: 'Aircraft location',
		0xc0: 'Frequency support',
		0xc1: 'Airport coverage',
		0xc4: 'ATN router NETs (raw)',
		0xc5: 'System mask',
		0xc8: 'Ground station location',
	};
	const name = (group === 0x80 ? publicNames : group === 0xf0 ? privateNames : {})[id] ?? 'Unknown';
	const result: XidParameter = { id, name, raw };
	if ((group === 0x80 && id === 1) || (group === 0xf0 && [0, 0x83, 0xc1].includes(id))) {
		if (raw.length && raw.every((byte) => byte >= 32 && byte <= 126)) result.value = String.fromCharCode(...raw);
	} else if (group === 0xf0) {
		result.value = privateValue(id, raw);
	}
	return result;
}

function privateValue(id: number, raw: Uint8Array): XidParameter['value'] {
	if (id === 1 && raw.length === 1 && raw[0] <= 3) return raw[0];
	if (id === 0xc8 && raw.length === 3) return location(raw);
	if (id === 0x84 && raw.length === 4) {
		const value = location(raw);
		if (value) return { ...value, altitude: raw[3] * 1000, altitudeUnit: 'ft' };
	}
	if (id === 0xc0 && raw.length % 6 === 0) return frequencies(raw);
	if (id === 0xc5 && raw.length % 4 === 0) {
		try {
			return Array.from(
				{ length: raw.length / 4 },
				(_, index) => decodeAvlcAddress(raw.slice(index * 4, index * 4 + 4)).address,
			);
		} catch {
			return;
		}
	}
}

function location(bytes: Uint8Array): XidLocation | undefined {
	const signed = (value: number) => (value >= 2048 ? value - 4096 : value);
	const latitude = signed(bytes[0] * 16 + (bytes[1] >>> 4)) / 10;
	const longitude = signed((bytes[1] & 15) * 256 + bytes[2]) / 10;
	if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude };
}

function frequencies(bytes: Uint8Array): XidFrequency[] | undefined {
	const values: XidFrequency[] = [];
	try {
		for (let index = 0; index < bytes.length; index += 6) {
			const modulation = bytes[index] >>> 4;
			const channel = (bytes[index] & 15) * 256 + bytes[index + 1];
			values.push({
				frequency: (Math.ceil(((channel + 10000) * 10) / 25) * 25) / 1000,
				unit: 'MHz',
				modulation,
				modulationName:
					modulation === 2 ? 'VDL-M2, D8PSK, 31500 bps' : modulation === 4 ? 'VDL-M3, D8PSK, 31500 bps' : 'Unknown',
				groundAddress: decodeAvlcAddress(bytes.slice(index + 2, index + 6)).address,
			});
		}
	} catch {
		return;
	}
	return values;
}
