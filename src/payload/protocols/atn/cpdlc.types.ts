import type { AtnBitString } from './types';

export interface AtnCpdlcDescriptor {
	kind: string;
	minimum?: number | null;
	maximum?: number | null;
	count?: number;
	extensible?: boolean;
	type?: string;
	enumeration?: Record<string, string>;
	members?: Array<{
		name: string;
		type: string;
		extension: boolean;
		optional?: boolean;
		index?: number;
		defaultValue?: number;
	}>;
}

export interface AtnCpdlcValue {
	type: string;
	name?: string;
	startBit: number;
	bitLength: number;
	/** ASN.1 DEFAULT value absent from the wire; bitLength is zero. */
	defaulted?: boolean;
	value?: number | string | boolean | null | AtnBitString;
	enumeration?: string;
	choice?: string;
	choiceIndex?: number;
	children?: AtnCpdlcValue[];
	measurement?: { value: number; unit: string; scale: number; reference?: string };
	extensions?: Array<{ index: number; payload: Uint8Array; value?: AtnCpdlcValue }>;
}

export interface AtnCpdlcOptions {
	direction: 'uplink' | 'downlink';
	mode: 'plain' | 'protected';
	bitLength?: number;
}

/** Schema structure only; protected bytes do not expose unverified measurements. */
export interface AtnCpdlc {
	protocol: 'ATN-CPDLC';
	direction: 'uplink' | 'downlink';
	mode: 'plain' | 'protected';
	raw: Uint8Array;
	bitLength: number;
	consumedBits: number;
	structureComplete: boolean;
	integrity: 'unverified';
	value: AtnCpdlcValue;
	notes: string[];
	source: { repository: string; revision: string; files: string[] };
}

export interface AtnCpdlcState {
	nodes: number;
	descriptors: Record<string, AtnCpdlcDescriptor>;
}
