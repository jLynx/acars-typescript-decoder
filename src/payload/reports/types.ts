export interface XmlNode {
	name: string;
	attributes: Record<string, string>;
	text: string;
	children: XmlNode[];
}
export interface RtrField {
	/** Element/attribute path in the transmitted XML, with one-based indices for repeated records. */
	path: string;
	label: string;
	value: string;
}
export interface RtrReport {
	protocol: 'RTR';
	coverage: 'partial';
	/** XML structure alone provides no application checksum verification. MIAM integrity is reported separately. */
	integrity: 'unverified';
	raw: string;
	fields: RtrField[];
}
