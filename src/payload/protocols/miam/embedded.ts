import type { AcarsRecord } from '@/types';
import type { AcarsInterpretation } from '@/payload/types';

/** Dispatch only checksum-verified text with an explicit ACARS application address. */
export function interpretMiamEmbedded(
	result: AcarsInterpretation,
	message: AcarsRecord,
	dispatch: (message: AcarsRecord) => AcarsInterpretation,
): void {
	const transfer = result.transfer;
	if (
		!transfer ||
		transfer.integrity !== 'verified' ||
		transfer.text === undefined ||
		transfer.encoding !== 0 ||
		transfer.applicationType > 2 ||
		transfer.text.length > 8192
	)
		return;
	const label = transfer.application.slice(0, 2);
	if (label === 'MA' || (label === 'H1' && /^T[0-3.-][0-3]/.test(transfer.text))) return;
	let text = transfer.text;
	if (label === 'H1' && transfer.applicationType >= 1) {
		const sublabel = transfer.application.slice(2, 4);
		const functionCode = transfer.applicationType === 2 ? `/${transfer.application.slice(4, 6)} ` : '';
		text = `${message.direction === 'downlink' ? `#${sublabel}B` : `- #${sublabel}`}${functionCode}${text}`;
	}
	const embedded = dispatch({ ...message, label, text, continuation: false });
	result.embedded = embedded;
	if (embedded.maintenance)
		result.fields.push(...embedded.fields.map(({ label, value }) => ({ label: `Embedded ${label}`, value })));
	result.coverage = embedded.coverage === 'decoded' ? 'decoded' : 'partial';
	result.coverageDetail = `Transfer body decoded and verified · embedded ${embedded.title}`;
	result.notes.push(`Embedded application ${label}: ${embedded.summary}`);
}
