import type {
	CotpChain,
	CotpNegotiation,
	CotpPdu,
	CotpSessionReception,
	CotpTiming,
	CotpWindow,
	CotpQuality,
	CotpSelectiveBlock,
} from '@/transport/network/types';

export interface ConnectOffer {
	format: 'normal' | 'extended';
	size: number;
	preferredSize?: number;
	requestAcknowledgement: boolean;
	nonBlockingExpedited: boolean;
	selectiveAcknowledgement: boolean;
	quality: CotpQuality;
	timing: CotpTiming;
	expedited: boolean;
	omitChecksum: boolean;
	credit: number;
	calling?: Uint8Array;
	called?: Uint8Array;
}

export interface SessionConnection {
	id: string;
	link: string;
	direction: CotpSessionReception['direction'];
	initiator: number;
	responder?: number;
	firstAt: number;
	lastAt: number;
	state: 'pending' | 'established' | 'frozen';
	until?: number;
	request: CotpPdu;
	confirm?: CotpPdu;
	offer: ConnectOffer;
	negotiation?: CotpNegotiation;
	chains?: Record<CotpSessionReception['direction'], CotpChain>;
	windows?: Record<CotpSessionReception['direction'], CotpWindow>;
	expedited?: Record<CotpSessionReception['direction'], ExpeditedState>;
	releases?: Partial<Record<CotpSessionReception['direction'], CotpPdu>>;
	confirmations?: Partial<Record<CotpSessionReception['direction'], CotpPdu>>;
	selective?: Record<CotpSessionReception['direction'], CotpSelectiveBlock[]>;
	atnChecksum?: 16 | 32;
	atnAddresses?: CotpSessionReception['atnAddresses'];
}

export interface ExpeditedState {
	pending?: number;
	acknowledged?: number;
	sent: boolean;
}
