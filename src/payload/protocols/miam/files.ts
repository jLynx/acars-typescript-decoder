// ACARS CF file frames adapted from MIT libacars miam.c; revision in docs/upstreams.json.
import type { AcarsRecord } from '@/types';
import type { AcarsInterpretation, AcarsField } from '@/payload/types';
import type { MiamFileFrame } from './types';

export function readMiamFile(text: string): MiamFileFrame | undefined {
	if (text.length > 8192) return;
	const value = text[0] === 'S' ? text : text.replace(/[\r\n]+$/, '');
	let match = /^F(\d{3})(\d{6})(\d{12})$/.exec(value);
	if (match) {
		if (!validDate(match[3])) return;
		return { type: 'F', fileId: match[1], size: Number(match[2]), validity: match[3] };
	}
	match = /^K(\d{3})([0-9A-F])(\d{3})(\d{3})$/.exec(value);
	if (match)
		return {
			type: 'K',
			fileId: match[1],
			segmentSize: parseInt(match[2], 16),
			groundTempo: Number(match[3]),
			flightTempo: Number(match[4]),
		};
	match = /^S(\d{3})(\d{3})([^]+)$/.exec(value);
	if (match && Number(match[2]) > 0) return { type: 'S', fileId: match[1], sequence: Number(match[2]), text: match[3] };
	match = /^A(\d{3})(\d)$/.exec(value);
	if (match) return { type: 'A', fileId: match[1], reason: Number(match[2]) };
	match = /^Y(\d{3}|FFF)$/.exec(value);
	if (match) return { type: 'Y', fileId: match[1] };
	match = /^X(\d{3}|FFF)(\d{3})(\d{3})$/.exec(value);
	if (match) return { type: 'X', fileId: match[1], groundTempo: Number(match[2]), flightTempo: Number(match[3]) };
}

function validDate(text: string): boolean {
	const [year, month, day, hour, minute, second] = text.match(/\d{2}/g)!.map(Number);
	const days = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59;
}

const titles = { F: 'request', K: 'acceptance', S: 'segment', A: 'abort', Y: 'pause', X: 'resume' };
const reasons = ['Refused', 'Out of context', 'Sender stopped', 'Receiver stopped', 'Transmission failed'];

export function interpretMiamFile(message: AcarsRecord): AcarsInterpretation | undefined {
	if (!['MA', 'H1'].includes(message.label)) return;
	const frame = readMiamFile(message.text);
	if (!frame) return;
	const fields: AcarsField[] = [{ label: 'File ID', value: frame.fileId === 'FFF' ? 'All files' : frame.fileId }];
	if (frame.type === 'F')
		fields.push(
			{ label: 'Declared file size', value: `${frame.size} bytes` },
			{ label: 'Validity (YYMMDDHHMMSS, raw)', value: frame.validity },
		);
	if (frame.type === 'K') fields.push({ label: 'Segment size code', value: String(frame.segmentSize) });
	if (frame.type === 'S')
		fields.push(
			{ label: 'File segment number', value: String(frame.sequence) },
			{ label: 'File segment text (raw)', value: frame.text },
		);
	if (frame.type === 'A')
		fields.push({ label: 'Abort reason', value: reasons[frame.reason] ?? `Unknown (${frame.reason})` });
	if (frame.type === 'K' || frame.type === 'X')
		fields.push(
			{ label: 'On-ground segment tempo', value: `${frame.groundTempo} seconds` },
			{ label: 'In-flight segment tempo', value: `${frame.flightTempo} seconds` },
		);
	return {
		title: `MIAM file transfer ${titles[frame.type]}`,
		summary: `File ${frame.fileId} · ${titles[frame.type]}.`,
		coverage:
			frame.type === 'S' || message.continuation || (frame.type === 'A' && frame.reason > 4) ? 'partial' : 'decoded',
		fields,
		notes:
			frame.type === 'S'
				? ['File content requires a matching request and every segment; application integrity is not yet verified.']
				: ['CF transfer control fields decoded; this frame contains no application measurements.'],
	};
}
