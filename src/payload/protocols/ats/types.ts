/** Machine-readable ATS fields accompany the existing display interpretation. */
export interface AtsResult {
	protocol: 'AFN' | 'TI2' | 'OC1';
	variant: string;
	values: Record<string, string | number | string[]>;
	raw: string;
	unconsumed: string[];
	integrity: { status: 'unverified'; checksum?: string };
	source: { repository: string; revision: string; files: string[] };
}
