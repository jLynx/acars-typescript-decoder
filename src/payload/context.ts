import type { AcarsRecord } from '@/types';
import { interpretAcars } from './interpret';
import type { AcarsInterpretation, InterpretedAcarsRecord } from './types';
import { assembleAcars } from './protocols/assembly';
import { assembleOhma } from './protocols/ohma/assembly';
import { assembleMiamFiles } from './protocols/miam/assembly';
import { interpretMiamEmbedded } from './protocols/miam/embedded';

const contextLabels = new Set([
	'Aircraft type',
	'Report ID',
	'Reported registration',
	'Reported flight code',
	'Departure',
	'Destination',
	'Reported event',
	'Report format',
	'Report code (raw)',
	'Report code',
]);

function markCompleteReport(interpretation: AcarsInterpretation): void {
	if (interpretation.title !== 'Aircraft report fragment') return;
	interpretation.title = 'Aircraft report';
	interpretation.summary = 'Complete DF report received · payload measurements remain undecoded.';
	interpretation.notes = interpretation.notes.filter(
		(note) => !note.startsWith('This block has no recognized report header.'),
	);
	interpretation.notes.push(
		'All consecutive blocks were received, but this report header and numeric layout are unsupported.',
	);
}

function reportSublabel(message: AcarsRecord): string | undefined {
	if (message.label !== 'H1' || message.direction !== 'downlink') return;
	return /^#(DF|T5)B/.exec(message.text)?.[1];
}

function canInheritReport(result: InterpretedAcarsRecord): boolean {
	return (
		!result.assembledText &&
		result.interpretation.coverage === 'unknown' &&
		['Aircraft report fragment', 'Terminal / aircraft application message'].includes(result.interpretation.title)
	);
}

/** Decodes complete assemblies and associates available header context within one source log. */
export function interpretAcarsLog(
	records: readonly AcarsRecord[],
	airportLookup?: (code: string) => string | undefined,
): InterpretedAcarsRecord[] {
	const headers = new Map<string, InterpretedAcarsRecord>();
	const ordered = [...records].sort((a, b) => a.receivedAt - b.receivedAt || a.id - b.id);
	const { completed, failures, statuses } = assembleAcars(ordered);
	const interpreted = ordered.map((message) => {
		const assembly = completed.get(message.id);
		const result: InterpretedAcarsRecord = {
			...message,
			interpretation: interpretAcars(assembly ? { ...message, text: assembly.text } : message, airportLookup),
		};
		if (assembly) {
			result.assembledText = assembly.text;
			markCompleteReport(result.interpretation);
			result.interpretation.notes.push(
				`Reassembled ${assembly.blocks.length} consecutive blocks: ${assembly.blocks.join(', ')}. Original received blocks remain available separately.`,
			);
		}
		const number = /^([A-Z0-9]{3})([A-Z])$/.exec(message.messageNumber ?? '');
		const sublabel = reportSublabel(message);
		if (!number || !sublabel) return result;
		const key = `${message.registration}\0${message.mode}\0${sublabel}\0${number[1]}`;
		const header = headers.get(key);
		if (number[2] === 'A') {
			headers.delete(key);
			if (
				message.continuation &&
				result.interpretation.fields.some((field) =>
					['Aircraft type', 'Report format', 'Report code'].includes(field.label),
				)
			)
				headers.set(key, result);
			return result;
		}
		if (
			!header ||
			message.receivedAt - header.receivedAt > 120_000 ||
			(header.flight && message.flight && header.flight !== message.flight)
		)
			return result;
		if (!canInheritReport(result)) return result;
		const fields = header.interpretation.fields.filter((field) => contextLabels.has(field.label));
		const event = fields.find((field) => field.label === 'Reported event')?.value;
		result.interpretation.title = `${header.interpretation.title} · block ${number[2]}`;
		result.interpretation.summary = `Related to ${event ?? header.interpretation.title} · application body remains undecoded.`;
		result.interpretation.coverageDetail = 'Related report identified · application body undecoded';
		result.interpretation.fields.push(
			...fields.map((field) => ({ label: `${field.label} (from first block)`, value: field.value })),
		);
		result.interpretation.notes = [
			`Report context comes from separately received block ${header.messageNumber}, matched by aircraft, source and message number within two minutes.`,
			'Blocks are not reassembled; missing intermediate blocks are possible. The application body requires the aircraft report specification.',
		];
		if (message.continuation) result.interpretation.notes.push('This block continues in another transmission (ETB).');
		else headers.delete(key);
		return result;
	});
	for (const result of interpreted) {
		const status = statuses.get(result.id);
		if (status) result.assemblies = [status];
		const reason = failures.get(result.id);
		if (reason) result.interpretation.notes.push(`Reassembly unavailable: ${reason}`);
	}
	assembleOhma(interpreted, airportLookup);
	assembleMiamFiles(interpreted);
	for (const record of interpreted) {
		if (!record.interpretation.embedded)
			interpretMiamEmbedded(record.interpretation, record, (message) => interpretAcars(message, airportLookup));
	}
	return interpreted;
}
