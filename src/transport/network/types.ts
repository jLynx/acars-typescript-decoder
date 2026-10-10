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
	derived?: boolean;
	more?: boolean;
	raw: Uint8Array;
	payload: Uint8Array;
	cotp?: CotpResult;
	idrp?: IdrpHeader;
}

export interface ClnpCompressedContext {
	/** Directed link identity including receiver and peer pair; local references are scoped to this link. */
	link: string;
	localReference: number;
	/** Caller-established address mapping. Compressed data cannot recover an absent setup exchange. */
	source: Uint8Array;
	destination: Uint8Array;
	priority?: number;
	version?: number;
	security?: Uint8Array;
}

export interface ClnpCompressedReception extends ClnpReception {
	/** Link envelope must be independently verified before compressed bytes enter assembly state. */
	linkIntegrity: 'verified' | 'failed' | 'unverified';
}

export interface ClnpCompressedAssembly {
	status: 'pending' | 'complete' | 'duplicate' | 'failed' | 'ignored';
	packet: ClnpCompressed;
	context?: ClnpCompressedContext;
	fragments: number;
	discarded: string[];
	reason?: string;
	payload?: Uint8Array;
	cotp?: CotpResult;
	idrp?: IdrpHeader;
}

export interface ClnpCompressedReassembler {
	/** Register a known directed compression context; replacement clears its messages. */
	open: (context: ClnpCompressedContext, receivedAt: number) => string[];
	/** Observe verified uncompressed CLNP with Mobile SNDCF local-reference option 5. */
	observe: (bytes: Uint8Array, reception: ClnpCompressedReception) => ClnpContextObservation;
	push: (bytes: Uint8Array, reception: ClnpCompressedReception) => ClnpCompressedAssembly;
	reset: (link?: string) => void;
	stats: () => { contexts: number; assemblies: number; bytes: number };
}

export interface ClnpContextObservation {
	status: 'registered' | 'duplicate' | 'ignored' | 'failed';
	packet: ClnpPdu;
	context?: ClnpCompressedContext;
	discarded: string[];
	reason?: string;
}

export interface NetworkOption {
	id: number;
	name: string;
	raw: Uint8Array;
	value?: number;
	unit?: 's';
	decoded?: NetworkOptionValue;
	/** Known malformed/reserved values are retained with an explanation. */
	reason?: string;
}

export interface NetworkOptionValue {
	format?: number;
	data?: Uint8Array;
	mode?: 'complete' | 'partial';
	pointer?: number;
	terminated?: boolean;
	entries?: Array<{ address: Uint8Array; timestamp?: number; timestampUnit?: 'ms'; utcMidnight?: boolean }>;
	unused?: Uint8Array;
	qosUnavailable?: boolean;
	sequencingPreferred?: boolean;
	congestionExperienced?: boolean;
	lowDelayOverCost?: boolean;
	lowErrorOverDelay?: boolean;
	lowErrorOverCost?: boolean;
	prefixes?: Array<{ bits: number; bytes: Uint8Array }>;
	radius?: number;
	discardReason?: number;
	errorOffset?: number;
}

export interface EsisOptions {
	/** Modern ISO 9542 address list by default; explicitly select the older RFC 995 single address or raw-only mode. */
	eshFormat?: 'address-list' | 'legacy-single' | 'raw';
}

export interface EsisPdu {
	protocol: 'ES-IS';
	type: 'End System Hello' | 'Intermediate System Hello' | 'Redirect';
	/** NSAP bytes are retained without address-component interpretation; some option bodies remain raw. */
	coverage: 'partial';
	holdingTime: number;
	holdingTimeUnit: 's';
	integrity: 'verified' | 'failed' | 'unverified';
	raw: Uint8Array;
	networkEntityTitle?: Uint8Array;
	destination?: Uint8Array;
	betterSubnetworkAddress?: Uint8Array;
	addressesRaw?: Uint8Array;
	/** ESH source NSAPs in transmitted order; bytes, not inferred names or address components. */
	sourceAddresses?: Uint8Array[];
	eshFormat?: 'address-list' | 'legacy-single' | 'raw';
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

export interface ClnpReassemblyOptions extends CotpOptions {
	/** Maximum retained messages, including duplicate/failure records (default 64, maximum 256). */
	maxAssemblies?: number;
	/** Maximum payload bytes per message (default/maximum 8192). */
	maxBytes?: number;
	/** Maximum fragments adding new bytes per message (default 128, maximum 1024). */
	maxFragments?: number;
	/** Expiry from first reception (default 60000 ms), further bounded by each PDU's lifetime. */
	retentionMs?: number;
}

export interface ClnpReception {
	/** Caller-defined network scope including receiver and direction; isolates identical NSAP/message IDs. */
	link: string;
	receivedAt: number;
}

export interface ClnpAssembly {
	status: 'pending' | 'complete' | 'duplicate' | 'failed' | 'ignored';
	packet: ClnpPdu;
	fragments: number;
	reason?: string;
	/** Message keys expired or evicted while accepting this PDU. */
	discarded: string[];
	/** Complete data only after every accepted header verifies. CLNP does not checksum these data bytes. */
	payload?: Uint8Array;
	cotp?: CotpResult;
	idrp?: IdrpHeader;
}

export interface ClnpReassembler {
	/** Accept in reception order; segment offsets may arrive in any order. Malformed PDUs throw. */
	push: (bytes: Uint8Array, reception: ClnpReception) => ClnpAssembly;
	reset: (link?: string) => void;
	/** Retained messages and allocated payload storage; includes complete duplicate records. */
	stats: () => { assemblies: number; bytes: number };
}

export interface ClnpChain {
	link: string;
	firstAt: number;
	lastAt: number;
	deadline: number;
	header: Uint8Array;
	data: Uint8Array;
	present: Uint8Array;
	covered: number;
	fragments: number;
	failure?: string;
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
	validation?: Uint8Array;
	/** Authentication mechanisms are retained; no key or validation algorithm is inferred. */
	integrity?: 'unverified';
	coverage?: 'decoded' | 'partial';
	reason?: string;
	open?: IdrpOpen;
	update?: IdrpUpdate;
	error?: { code: number; subcode: number; data: Uint8Array; relatedType?: number; state?: number };
}

export interface IdrpAttribute {
	id: number;
	name: string;
	flags?: number;
	raw: Uint8Array;
	value?: number | { routeId: number; localPreference: number };
	rdPath?: Array<{ type: number; name: string; identifiers: Uint8Array[]; raw: Uint8Array }>;
	security?: AtnSecurityLabel;
	reason?: string;
}

export interface AtnSecurityLabel {
	registration: Uint8Array;
	tags: Array<{
		name: Uint8Array;
		raw: Uint8Array;
		value?: number;
		traffic?: {
			type?: 'operational' | 'administrative' | 'system-management';
			category?: 'ATSC' | 'AOC';
			routePolicy: number;
		};
		subnetwork?: { id: number; permittedTraffic: number };
		allowNonAtsc?: boolean;
	}>;
	unconsumed: Uint8Array;
	coverage: 'decoded' | 'partial';
}

export interface IdrpOpen {
	version: number;
	holdingTime: number;
	holdingTimeUnit: 's';
	maxPduSize: number;
	sourceRdi: Uint8Array;
	ribAttributeSets: IdrpAttribute[][];
	confederations: Uint8Array[];
	authentication: number;
	authenticationData: Uint8Array;
}

export interface IdrpUpdate {
	withdrawnRoutes: number[];
	attributes: IdrpAttribute[];
	reachability: Array<{ protocolType: number; protocol: Uint8Array; address: Uint8Array; prefixBits?: number }>;
}

export interface CotpOptions {
	/** Negotiated sequence-number format. Needed when optional fields make the header ambiguous. */
	format?: 'normal' | 'extended';
	/** Local NSDU input bound, default 8192, maximum 65535 bytes. Does not change negotiated TPDU size. */
	maxNsduBytes?: number;
	/** Directed network addresses required by the ATN extended transport checksum pseudo-trailer. */
	atnAddresses?: { source: Uint8Array; destination: Uint8Array };
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
	/** Validated negotiated non-blocking ED dependency, used by passive session delivery. */
	expeditedSequence?: number;
	/** Sequence format actually used to parse a DT/ED/acknowledgement header. */
	format?: 'normal' | 'extended';
	/** ISO 8073 checksum over this entire TPDU. Does not verify ATN application integrity. */
	integrity: 'verified' | 'failed' | 'unverified';
	/** Separate ATN extended checksum evidence; absent/unknown addresses remain unverified. */
	atnIntegrity?: 'verified' | 'failed' | 'unverified';
	rawHeader: Uint8Array;
	/** All TLV occurrences in wire order; the last occurrence of an ID is effective (RFC 905 §13.2.3). */
	parameters: CotpParameter[];
	userData?: Uint8Array;
}

export interface CotpResult {
	protocol: 'COTP';
	coverage: 'headers' | 'partial';
	/** Failed if any TPDU fails, verified only if all TPDUs verify and no bytes remain unparsed. */
	integrity: 'verified' | 'failed' | 'unverified';
	pdus: CotpPdu[];
	raw: Uint8Array;
	unconsumed: Uint8Array;
}

export interface CotpConnection {
	/** Isolate receiver, source/destination NSAPs, connection generation and direction. */
	link: string;
	destinationReference: number;
	/** Format negotiated for this class-4 connection. */
	format: 'normal' | 'extended';
	/** First expected DT at a known TSDU boundary; defaults to zero for a new connection. */
	startSequence?: number;
	/** Peer reference expected in DR/DC; required for passive disconnect handling. */
	sourceReference?: number;
	/** Present only when expedited service was negotiated. It has an independent sequence boundary. */
	expedited?: CotpExpeditedOptions;
	/** Caller-established ATN profile; a required checksum cannot disappear or change width. */
	atnChecksum?: 16 | 32;
	atnAddresses?: CotpOptions['atnAddresses'];
}

export interface CotpExpeditedOptions {
	/** First expected ED at a known service boundary; defaults to zero for a new connection. */
	startSequence?: number;
}

export interface CotpReception {
	link: string;
	receivedAt: number;
}

export interface CotpReassemblyOptions {
	/** Local NSDU input bound, default 8192, maximum 65535 bytes. */
	maxNsduBytes?: number;
	/** Maximum explicitly opened directional connections (default 64, maximum 256). */
	maxConnections?: number;
	/** Maximum pending data and duplicate-history bytes each per connection (default/maximum 65536). */
	maxBytes?: number;
	/** Maximum DTs retained for pending messages (default 128, maximum 1024). */
	maxFragments?: number;
	/** Forward sequence window and duplicate-history count (default 32, maximum 63). */
	windowSize?: number;
	/** Pending-message timeout and idle connection expiry (default 60000 ms, maximum one hour). */
	retentionMs?: number;
}

export interface CotpAssembly {
	status: 'pending' | 'complete' | 'duplicate' | 'failed' | 'ignored' | 'closed';
	/** Independent normal DT or expedited ED sequence space; absent for unassociated controls/errors. */
	service?: 'normal' | 'expedited';
	destinationReference: number;
	fragments: number;
	reason?: string;
	firstSequence?: number;
	lastSequence?: number;
	/** Complete TSDU with verified ISO 8073 checksums; ATN application integrity remains unverified. */
	payload?: Uint8Array;
}

export interface CotpReassemblyResult {
	packet: CotpResult;
	/** One DT can release multiple complete messages after filling a sequence gap. */
	assemblies: CotpAssembly[];
	/** Connection keys expired, evicted or closed during this call. */
	discarded: string[];
}

export interface CotpReassembler {
	/** Explicitly establish a known class-4 DT/TSDU boundary; replaces any prior state for this identity. */
	open: (connection: CotpConnection, receivedAt: number) => string[];
	/** Accept complete NSDUs in reception order. Every TPDU must have a verified ISO 8073 checksum. */
	push: (bytes: Uint8Array, reception: CotpReception) => CotpReassemblyResult;
	reset: (link?: string, destinationReference?: number) => void;
	stats: () => { connections: number; bytes: number };
}

export interface CotpFragment {
	sequence: number;
	end: boolean;
	data: Uint8Array;
	expeditedSequence?: number;
}

export interface CotpSequenceLimits {
	maxBytes: number;
	maxFragments: number;
	windowSize: number;
}

export interface CotpChain {
	link: string;
	format: 'normal' | 'extended';
	next: number;
	lastAt: number;
	firstAt?: number;
	firstSequence: number;
	queue: Map<number, CotpFragment>;
	history: CotpFragment[];
	parts: CotpFragment[];
	length: number;
	fragments: number;
	failure?: string;
	sourceReference?: number;
	expedited?: CotpChain;
	atnChecksum?: 16 | 32;
	atnAddresses?: CotpOptions['atnAddresses'];
}

export interface CotpSessionOptions extends Omit<CotpReassemblyOptions, 'maxConnections'> {
	/** Maximum pending/established/frozen connection records (default 64, maximum 256). */
	maxRecords?: number;
	/** Reference quarantine after release/expiry (default 60000 ms, maximum one hour). Local capture policy, not negotiated L. */
	freezeMs?: number;
}

export interface CotpSessionReception {
	/** Receiver and unordered peer NSAP pair. Keep both directions on the same scope. */
	link: string;
	direction: 'a-to-b' | 'b-to-a';
	receivedAt: number;
	atnAddresses?: CotpOptions['atnAddresses'];
}

export interface CotpNegotiation {
	protocolClass: 4;
	format: 'normal' | 'extended';
	/** Selected maximum in bytes, including headers. Independent of the configured local NSDU input bound. */
	tpduSize: number;
	requestAcknowledgement: boolean;
	nonBlockingExpedited: boolean;
	selectiveAcknowledgement: boolean;
	/** User-defined protection bytes and advertised QoS; no inferred security guarantees. */
	initiatorQuality: CotpQuality;
	responderQuality: CotpQuality;
	/** Per-peer indications, not negotiated capture-expiry policies. */
	initiatorTiming: CotpTiming;
	responderTiming: CotpTiming;
	expedited: boolean;
	checksum: 'required' | 'omitted';
	atnChecksum?: 16 | 32;
	/** Initial credit sent by each peer; advertised values, not a tracked transmit window. */
	initiatorCredit: number;
	responderCredit: number;
	callingSelector?: Uint8Array;
	calledSelector?: Uint8Array;
}

export interface CotpSessionEvent {
	status: 'requested' | 'established' | 'duplicate' | 'closed' | 'failed' | 'ignored' | 'acknowledged';
	reason?: string;
	connectionId?: string;
	negotiation?: CotpNegotiation;
	acknowledgement?: CotpAcknowledgement;
	release?: CotpRelease;
	/** Wire evidence of an ER; receipt alone does not establish an established connection's release. */
	transportError?: { cause: number; rejectedHeader?: Uint8Array; pendingRequestReleased: boolean };
}

export interface CotpTiming {
	acknowledgementMs?: number;
	inactivityMs?: number;
}

export interface CotpWindow {
	lower: number;
	upper: number;
	credit: number;
	subsequence: number;
}

export interface CotpAcknowledgement {
	/** Direction of data acknowledged; opposite to the ACK's reception direction. */
	direction: CotpSessionReception['direction'];
	service: 'normal' | 'expedited';
	sequence: number;
	window?: CotpWindow;
	/** Whether FCC echoes the currently retained opposite window. */
	flowControlConfirmed?: boolean;
	/** Capture evidence only; false means the ACK crosses an uncaptured/incomplete data range. */
	dataObserved: boolean;
	/** Inclusive sequence ranges retained until cumulatively acknowledged; never fill captured data gaps. */
	selectiveBlocks?: CotpSelectiveBlock[];
}

export interface CotpSelectiveBlock {
	lower: number;
	upper: number;
}

export interface CotpQuality {
	protection?: Uint8Array;
	priority?: number;
	/** Exponents retained exactly; no guessed sign or negotiated probability. */
	residualError?: { targetExponent: number; minimumExponent: number; tsduSizeExponent: number };
	throughput?: { maximum: number[]; average: number[]; unit: 'octets/s' };
	transitDelay?: { values: number[]; unit: 'ms'; tsduBytes: 128 };
	reassignmentSeconds?: number;
	alternativeClasses: number[];
}

export interface CotpRelease {
	stage: 'requested' | 'confirmed' | 'crossed' | 'unmatched-confirmation' | 'refused' | 'cancelled';
	direction: CotpSessionReception['direction'];
	reasonCode?: number;
	userData?: Uint8Array;
}

export interface CotpSessionResult {
	packet: CotpResult;
	events: CotpSessionEvent[];
	assemblies: CotpSessionAssembly[];
	/** IDs expired/released while processing this NSDU; their references remain quarantined. */
	discarded: string[];
}

export interface CotpSessionAssembly extends CotpAssembly {
	connectionId: string;
	direction: CotpSessionReception['direction'];
	/** Capture-side advertised transmit-window evidence for the incoming DT. Never replaces local resequencing limits. */
	transmission?: CotpTransmission;
	/** Transport checksum evidence; omission never becomes a verified checksum. */
	integrity?: 'verified' | 'unverified';
}

export interface CotpTransmission {
	sequence: number;
	window: CotpWindow;
	withinAdvertisedWindow: boolean;
	/** Blocking service sender-side evidence; a missing captured EA can leave this true. */
	awaitingExpeditedAcknowledgement: boolean;
	selectivelyAcknowledged?: boolean;
}

export interface CotpSession {
	/** Passive, complete bidirectional NSDUs within maxNsduBytes. Only checksum-verified class-4 connections are established. */
	push: (bytes: Uint8Array, reception: CotpSessionReception) => CotpSessionResult;
	/** Clear state at a known capture/network boundary; removes reference quarantine too. */
	reset: (link?: string) => void;
	stats: () => { pending: number; established: number; frozen: number; bytes: number };
}
