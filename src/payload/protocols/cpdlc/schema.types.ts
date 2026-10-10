export interface FansSchemaDescriptor {
	kind: string;
	constraints: number[] | null;
	members?: Array<[string, string, boolean]>;
	enumeration?: Record<string, string>;
}

export interface FansSchemaValue {
	type: string;
	name?: string;
	startBit: number;
	bitLength: number;
	value?: number | string | boolean | null;
	enumeration?: string;
	choice?: string;
	children?: FansSchemaValue[];
}

/** Schema validity is distinct from semantic/display completeness and integrity. */
export interface FansCpdlcStructure {
	protocol: 'FANS-CPDLC';
	direction: 'uplink' | 'downlink';
	raw: Uint8Array;
	value: FansSchemaValue;
	consumedBits: number;
	paddingValid: boolean;
	integrity: 'unverified';
	source: { repository: string; revision: string; files: string[] };
}

export interface FansSchemaState {
	nodes: number;
}
