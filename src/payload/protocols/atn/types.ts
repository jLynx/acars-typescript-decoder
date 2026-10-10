export interface AtnPresentationValue {
	contextIdentifier: number;
	context: 'acse-apdu' | 'reserved' | 'user-ase-apdu' | 'unknown';
	transferSyntax?: string;
	encoding: 'single-ASN1-type' | 'octet-aligned' | 'arbitrary';
	payload: Uint8Array;
	bitLength: number;
	profileSupported: boolean;
	acse?: AtnAcse;
}

export interface AtnBitString {
	payload: Uint8Array;
	bitLength: number;
}

export interface AtnAcseExternal extends AtnBitString {
	directReference?: string;
	indirectReference?: number;
	dataValueDescriptor?: Uint8Array;
	encoding: 'single-ASN1-type' | 'octet-aligned' | 'arbitrary';
}

export interface AtnAcse {
	protocol: 'ATN-ACSE';
	type: 'AARQ' | 'AARE' | 'RLRQ' | 'RLRE' | 'ABRT' | 'extension';
	raw: Uint8Array;
	bitLength: number;
	consumedBits: number;
	structureComplete: boolean;
	profileSupported: boolean;
	integrity: 'unverified';
	fields: Record<string, number | string | AtnBitString>;
	userInformation: AtnAcseExternal[];
	extensions: Array<{ index: number; payload: Uint8Array }>;
	notes: string[];
	source: { repository: string; revision: string; files: string[] };
}

/** Explicit connection/data mode avoids inferring ambiguous ATN application types. */
export interface AtnUlcs {
	protocol: 'ATN-ULCS';
	mode: 'data' | 'connection';
	raw: Uint8Array;
	coverage: 'partial';
	integrity: 'unverified';
	envelopeComplete: boolean;
	values: AtnPresentationValue[];
	session?: {
		type: 'SCN' | 'SCNC' | 'SAC' | 'SACC' | 'SRF' | 'SRFC';
		raw: number;
		parameterIndication?: boolean;
		transportReleased?: boolean;
		persistent?: boolean;
	};
	presentation?: {
		type: 'CP' | 'CPA' | 'CPR';
		raw: number;
		error?: { code: number; description: string };
	};
	application?: Uint8Array;
	acse?: AtnAcse;
	notes: string[];
	source: { repository: string; revision: string; files: string[] };
}
