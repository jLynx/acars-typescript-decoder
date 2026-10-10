// Fixed IDRP header layout adapted from MIT xoolive/datalink x25.rs.
import type { IdrpHeader } from './types';

export function decodeIdrp(bytes: Uint8Array): IdrpHeader | undefined {
	if (!(bytes instanceof Uint8Array) || bytes.length < 30 || bytes.length > 8192 || bytes[0] !== 0x85) return;
	const length = bytes[1] * 256 + bytes[2];
	if (length < 30 || length !== bytes.length) return;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return {
		protocol: 'IDRP',
		type: bytes[3],
		typeName: ['Unknown', 'Open', 'Update', 'Error', 'Keepalive', 'Cease', 'RIB Refresh'][bytes[3]] ?? 'Unknown',
		sequence: view.getUint32(4),
		acknowledgement: view.getUint32(8),
		creditOffered: bytes[12],
		creditAvailable: bytes[13],
		raw: bytes.slice(),
		payload: bytes.slice(30),
	};
}
