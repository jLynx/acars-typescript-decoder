import type { AcarsInterpretation } from '@/payload/types';
import { decodeBody } from './body';

/** CORE v2 field offsets from libacars miam-core.c; v2 omits aircraft ID and PDU length. */
export function interpretV2(
	header: Uint8Array,
	body: string,
	padding: string,
	continued: boolean,
): AcarsInterpretation | undefined {
	if (header.length < 4) return;
	const type = header[0] >> 4;
	const number = header[1] >> 1;
	if (type === 1) {
		if (header.length !== 8 || body) return;
		const status = ((header[1] << 3) | (header[2] >> 5)) & 15;
		const name =
			['Acknowledged', 'Not acknowledged', 'Time expired', 'Peer aborted', 'Local abort'][status] ??
			`Unknown result ${status}`;
		return {
			title: 'MIAM transfer acknowledgement',
			summary: `CORE v2 · application message ${number} · ${name}.`,
			coverage: status <= 4 ? 'decoded' : 'partial',
			fields: [
				{ label: 'MIAM transfer', value: 'Single transfer · CORE version 2' },
				{ label: 'Acknowledged application message', value: String(number) },
				{ label: 'Transfer result', value: name },
			],
			notes: ['Transfer acknowledgement; checksum echo is retained in the original header.'],
		};
	}
	if (type !== 0) return;
	const appType = header[3] & 15;
	const appLength = [2, 4, 6, 6][appType] ?? (appType & 8 && appType !== 13 ? (appType & 7) + 1 : 0);
	if (!appLength || header.length !== 4 + appLength + 2) return;
	const app = String.fromCharCode(...header.slice(4, 4 + appLength));
	if (!/^[A-Z0-9]{1,8}$/.test(app)) return;
	const compression = ((header[2] << 2) | (header[3] >> 6)) & 7;
	const encoding = (header[3] >> 4) & 3;
	const result: AcarsInterpretation = {
		title: 'MIAM application transfer',
		summary: `CORE v2 · ${app} · application data.`,
		coverage: 'partial',
		coverageDetail: 'Transfer header decoded · body undecoded',
		fields: [
			{ label: 'MIAM transfer', value: 'Single transfer · CORE version 2' },
			{ label: 'Application message number', value: String(number) },
			{ label: 'Application acknowledgement', value: header[1] & 1 ? 'Required' : 'Not required' },
			{ label: 'Application identifier', value: app },
			{ label: 'Compression', value: ['None', 'Deflate'][compression] ?? `Unknown (${compression})` },
			{ label: 'Encoding', value: ['ISO #5 text', 'Binary'][encoding] ?? `Unknown (${encoding})` },
		],
		notes: [],
	};
	decodeBody(
		result,
		{
			version: 2,
			applicationType: appType,
			application: app,
			compression,
			encoding,
			checksum: (header[4 + appLength] << 8) | header[5 + appLength],
			headerLength: header.length,
		},
		body,
		padding,
		continued,
	);
	return result;
}
