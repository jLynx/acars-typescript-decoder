import type { AtnCpdlcValue } from '@/payload/protocols/atn/cpdlc.types';

export interface AtnB2Options {
	direction: 'uplink' | 'downlink';
	application: 'cpdlc' | 'adsc';
	mode: 'application' | 'protected';
	/** ADS-C v2 inner message type; required for application-mode ADS-C. */
	message?: 'request' | 'report' | 'accept' | 'reject' | 'noncompliance' | 'positiveAcknowledgement';
	bitLength?: number;
}

export interface AtnB2Structure {
	protocol: 'ATN-B2-CPDLC' | 'ATN-ADSC-V2';
	direction: 'uplink' | 'downlink';
	mode: 'application' | 'protected';
	message?: AtnB2Options['message'];
	raw: Uint8Array;
	bitLength: number;
	consumedBits: number;
	structureComplete: boolean;
	integrity: 'unverified';
	value: AtnCpdlcValue;
	notes: string[];
	source: { repository: string; revision: string; files: string[] };
}
