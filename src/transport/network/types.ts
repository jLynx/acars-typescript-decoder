export interface X25Packet {
	protocol: 'X.25';
	type: 'Data' | 'Receive Ready' | 'Receive Not Ready' | 'Receive Reject' | 'Unknown';
	channelGroup: number;
	channel: number;
	qualifier: boolean;
	deliveryConfirmation: boolean;
	sendSequence?: number;
	receiveSequence?: number;
	more?: boolean;
	raw: Uint8Array;
	payload: Uint8Array;
	clnp?: ClnpCompressed;
	network?: ClnpPdu;
	esis?: EsisPdu;
}

export interface X25ReassemblyOptions extends CotpOptions {
	/** Maximum retained logical channels across all links (default 64, maximum 256). */
	maxChannels?: number;
	/** Maximum assembled user data per channel (default 8192, maximum 8192). */
	maxBytes?: number;
	/** Maximum packets in an assembly (default 128, maximum 1024). */
	maxFragments?: number;
	/** Reception-time expiry from the first fragment (default 60000 ms). */
	retentionMs?: number;
}

export interface X25Reception {
	/** Caller-defined circuit identity, including receiver, peer pair and direction. */
	link: string;
	receivedAt: number;
}

export interface X25Assembly {
	status: 'pending' | 'complete' | 'duplicate' | 'failed' | 'ignored';
	packet: X25Packet;
	fragments: number;
	reason?: string;
	/** Channel keys expired or evicted while accepting this packet. */
	discarded: string[];
	payload?: Uint8Array;
	clnp?: ClnpCompressed;
	network?: ClnpPdu;
	esis?: EsisPdu;
}

export interface X25Reassembler {
	/** Accept in reception order. Link CRC verification belongs to the caller's transport. */
	push: (bytes: Uint8Array, reception: X25Reception) => X25Assembly;
	/** Clear a link on circuit reset/disconnect, or clear all links. */
	reset: (link?: string) => void;
	stats: () => { channels: number; bytes: number };
}

export interface X25Chain {
	link: string;
	firstAt: number;
	lastAt: number;
	lastPacket: X25Packet;
	parts: Uint8Array[];
	length: number;
	fragments: number;
	complete?: boolean;
	failure?: string;
}

export interface ClnpCompressed {
	protocol: 'CLNP compressed';
	type: number;
	priority: number;
	flags: number;
	lifetime: number;
	lifetimeUnit: 's';
	localReference: number;
	pduId?: number;
	offset?: number;
	totalLength?: number;
	raw: Uint8Array;
	payload: Uint8Array;
	cotp?: CotpResult;
	idrp?: IdrpHeader;
}

export interface NetworkOption {
	id: number;
	name: string;
	raw: Uint8Array;
	value?: number;
}

export interface EsisPdu {
	protocol: 'ES-IS';
	type: 'End System Hello' | 'Intermediate System Hello' | 'Redirect';
	/** ESH address lists and option bodies are not fully interpreted. */
	coverage: 'partial';
	holdingTime: number;
	holdingTimeUnit: 's';
	integrity: 'verified' | 'failed' | 'unverified';
	raw: Uint8Array;
	networkEntityTitle?: Uint8Array;
	destination?: Uint8Array;
	betterSubnetworkAddress?: Uint8Array;
	addressesRaw?: Uint8Array;
	options?: NetworkOption[];
}

export interface ClnpPdu {
	protocol: 'CLNP';
	type: 'Data' | 'Error Report';
	headerLength: number;
	segmentLength: number;
	lifetime: number;
	lifetimeUnit: 's';
	segmentationPermitted: boolean;
	more: boolean;
	errorReportRequested: boolean;
	/** Header checksum only. Zero/omitted checksums are unverified. */
	integrity: 'verified' | 'failed' | 'unverified';
	raw: Uint8Array;
	destination?: Uint8Array;
	source?: Uint8Array;
	pduId?: number;
	offset?: number;
	totalLength?: number;
	options?: NetworkOption[];
	payload?: Uint8Array;
	cotp?: CotpResult;
	idrp?: IdrpHeader;
}

export interface IdrpHeader {
	protocol: 'IDRP';
	type: number;
	typeName: string;
	sequence: number;
	acknowledgement: number;
	creditOffered: number;
	creditAvailable: number;
	raw: Uint8Array;
	payload: Uint8Array;
}

export interface CotpOptions {
	/** Negotiated sequence-number format. Needed when optional fields make the header ambiguous. */
	format?: 'normal' | 'extended';
}

export interface CotpParameter {
	id: number;
	name: string;
	raw: Uint8Array;
	value?: number;
	unit?: 'ms' | 's' | 'bytes';
}

export interface CotpPdu {
	type: number;
	typeName: string;
	destinationReference: number;
	sourceReference?: number;
	protocolClass?: number;
	options?: number;
	disconnectReason?: number;
	rejectCause?: number;
	sendSequence?: number;
	receiveSequence?: number;
	credit?: number;
	endOfTransmission?: boolean;
	requestAcknowledgement?: boolean;
	rawHeader: Uint8Array;
	parameters: CotpParameter[];
	userData?: Uint8Array;
}

export interface CotpResult {
	protocol: 'COTP';
	coverage: 'headers' | 'partial';
	/** COTP checksums and ATN application integrity are not verified by this header reader. */
	integrity: 'unverified';
	pdus: CotpPdu[];
	raw: Uint8Array;
	unconsumed: Uint8Array;
}
