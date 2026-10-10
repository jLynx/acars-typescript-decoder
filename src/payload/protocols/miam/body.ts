import type { AcarsInterpretation } from '@/payload/types';
import type { MiamBody } from './types';
import { base85, crc16, crc32, inflateBounded } from './bytes';

export function decodeBody(
	result: AcarsInterpretation,
	info: MiamBody,
	text: string,
	padding: string,
	continued: boolean,
): void {
	try {
		if (continued) throw new Error('Continued transfer requires its final ETX');
		if (padding === '.') throw new Error('Transfer body is absent');
		const bytes = padding === '-' ? asciiBytes(text) : base85(text, Number(padding), 65536);
		if (info.length !== undefined && info.headerLength + bytes.length !== info.length)
			throw new Error('Declared PDU length does not match received body');
		if (info.compression > 1) throw new Error('Unsupported compression algorithm');
		const data = info.compression === 1 ? inflateBounded(bytes) : bytes;
		const checksum = info.version === 1 ? crc32(data) : crc16(data);
		result.fields.push({
			label: 'Application CRC',
			value: `${info.checksum
				.toString(16)
				.toUpperCase()
				.padStart(info.version === 1 ? 8 : 4, '0')} · ${checksum === info.checksum ? 'Verified' : 'Failed'}`,
		});
		if (checksum !== info.checksum) throw new Error('Application body CRC failed');
		result.fields.push({ label: 'Decoded body length', value: `${data.length} bytes` });
		const printable = data.every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126));
		const value = printable
			? new TextDecoder('ascii').decode(data)
			: Array.from(data, (byte) => byte.toString(16).padStart(2, '0'))
					.join('')
					.toUpperCase();
		result.transfer = {
			protocol: 'MIAM',
			version: info.version,
			applicationType: info.applicationType,
			application: info.application,
			encoding: info.encoding,
			integrity: 'verified',
			checksum: info.checksum,
			...(printable ? { text: value } : { hex: value }),
		};
		result.fields.push({
			label: printable ? 'Application text' : 'Application data (hex)',
			value,
		});
		result.coverageDetail = 'Transfer body decoded · application payload retained';
		result.notes = [
			'Transfer body and checksum verified. Embedded application interpretation is separate from decoding the transfer.',
		];
	} catch (error) {
		result.notes = [
			error instanceof Error
				? error.message + '. The transmitted body is preserved.'
				: 'Transfer body could not be decoded.',
		];
	}
}

function asciiBytes(text: string): Uint8Array {
	if ([...text].some((char) => char.charCodeAt(0) > 127)) throw new Error('Invalid ISO #5 text');
	return Uint8Array.from(text, (char) => char.charCodeAt(0));
}
