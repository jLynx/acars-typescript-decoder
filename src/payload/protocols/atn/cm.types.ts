export interface AtnCmAddress {
	format: 'long-tsap' | 'short-tsap';
	routingDomainPart?: Uint8Array;
	addressReference?: Uint8Array;
	localSystemNselTsel: Uint8Array;
}

export interface AtnCmApplication {
	aeQualifier: number;
	version: number;
	address?: AtnCmAddress;
}

export interface AtnCmDateTime {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	calendarValid: boolean;
}

/** Doc9705 Ed2 CMMessageSetVersion1; operational date use requires agreement. */
export interface AtnCm {
	protocol: 'ATN-CM';
	version: 1;
	direction: 'uplink' | 'downlink';
	type:
		| 'logon-request'
		| 'logon-response'
		| 'contact-request'
		| 'contact-response'
		| 'update'
		| 'forward-request'
		| 'forward-response'
		| 'abort'
		| 'extension';
	raw: Uint8Array;
	bitLength: number;
	consumedBits: number;
	structureComplete: boolean;
	integrity: 'unverified';
	flightIdentification?: string;
	address?: AtnCmAddress;
	addressedApplications?: AtnCmApplication[];
	otherApplications?: AtnCmApplication[];
	facility?: string;
	departure?: string;
	destination?: string;
	departureDateTime?: AtnCmDateTime;
	response?: { code: number; meaning: string };
	extension?: { index: number; payload: Uint8Array };
	notes: string[];
	source: { repository: string; revision: string; files: string[] };
}
