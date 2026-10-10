// Independently observed H1/CF RTR XML layout; unknown elements/codes and original XML remain available.
import type { AcarsInterpretation } from '@/payload/types';
import type { RtrField, RtrReport, XmlNode } from './types';
import { readReportXml } from './xml';

function singleton(node: XmlNode, name: string): XmlNode | undefined {
	const matches = node.children.filter((child) => child.name === name);
	if (matches.length > 1) throw new Error('Ambiguous singleton element');
	return matches[0];
}
function leaf(node: XmlNode | undefined): string | undefined {
	if (!node) return;
	if (node.children.length) throw new Error('Expected leaf element');
	return node.text;
}
function collect(
	node: XmlNode | undefined,
	path: string,
	label: string,
	fields: RtrField[],
	names: Record<string, string>,
): void {
	if (!node) return;
	for (const [name, caption] of Object.entries(names)) {
		const value = leaf(singleton(node, name));
		if (value !== undefined) fields.push({ path: `${path}/${name}`, label: `${label}${caption}`, value });
	}
}
function collectAttributes(
	node: XmlNode | undefined,
	path: string,
	label: string,
	fields: RtrField[],
	names: Record<string, string>,
): void {
	if (!node) return;
	for (const [name, caption] of Object.entries(names))
		if (Object.hasOwn(node.attributes, name))
			fields.push({ path: `${path}/@${name}`, label: `${label}${caption}`, value: node.attributes[name] });
}
function recordFields(node: XmlNode, path: string, label: string, fields: RtrField[]): void {
	collect(node, path, label, fields, {
		MC: 'code',
		MD: 'description',
		DA: 'date/time (raw)',
		ATA: 'ATA code (raw)',
		FPH: 'FPH (raw)',
		FCL: 'FCL (raw)',
		PRIO: 'priority (raw)',
		STA: 'status (STA, raw)',
	});
	collectAttributes(node, path, label, fields, { hdi: 'hdi (raw)', fo: 'fo (raw)', occ: 'occurrence (occ, raw)' });
	collectAttributes(singleton(node, 'SYS'), `${path}/SYS`, `${label}system `, fields, {
		name: 'name',
		bite_id: 'BITE identifier (raw)',
		side: 'side (raw)',
	});
}
/** Reads explicit RTR fields, without aircraft dictionaries, diagnosis or inferred units/timezone. */
export function decodeRtr(text: string): RtrReport | undefined {
	const root = readReportXml(text);
	if (!root) return;
	const fields: RtrField[] = [];
	try {
		const head = singleton(root, 'HEAD'),
			route = singleton(root, 'HEADRTR');
		if (!head || !route) return;
		collect(head, 'RTR/HEAD', '', fields, { DA: 'Report date/time (raw)', TID: 'Transfer identifier' });
		collectAttributes(singleton(head, 'IDCMS'), 'RTR/HEAD/IDCMS', 'CMS ', fields, {
			pn: 'part number',
			vers: 'version',
		});
		collectAttributes(singleton(head, 'ACD'), 'RTR/HEAD/ACD', '', fields, {
			MSN: 'Aircraft serial number (raw)',
			tail: 'Reported registration',
			type: 'Aircraft type',
		});
		collect(route, 'RTR/HEADRTR', '', fields, { FROM: 'Departure', TO: 'Destination', FNBR: 'Reported flight code' });
		for (const [index, detail] of root.children.filter((child) => child.name === 'ITD').entries()) {
			const path = `RTR/ITD[${index + 1}]`,
				prefix = `ITD ${index + 1} `;
			collect(detail, path, prefix, fields, { CB: 'CB (raw)' });
			for (const name of ['NFDE', 'MM'])
				for (const [recordIndex, record] of detail.children.filter((child) => child.name === name).entries())
					recordFields(record, `${path}/${name}[${recordIndex + 1}]`, `${prefix}${name} ${recordIndex + 1} `, fields);
		}
		if (fields.length > 128) return;
		return { protocol: 'RTR', coverage: 'partial', integrity: 'unverified', raw: text, fields };
	} catch {
		return;
	}
}
export function interpretRtr(text: string): AcarsInterpretation | undefined {
	const maintenance = decodeRtr(text);
	if (!maintenance) return;
	return {
		title: 'Aircraft maintenance report RTR',
		summary: 'RTR XML maintenance report · explicit identifiers and reported descriptions.',
		coverage: 'partial',
		coverageDetail: 'XML fields extracted · proprietary codes and status meanings unverified',
		fields: maintenance.fields.map(({ label, value }) => ({ label, value })),
		maintenance,
		notes: [
			'Reported descriptions are transmitted text, not an inferred diagnosis. Unknown elements and attributes remain in the original XML.',
			'Date/time values retain their transmitted format; timezone, numeric codes, status flags and aircraft-specific meanings are unverified. XML parsing supplies no application integrity check.',
		],
	};
}
