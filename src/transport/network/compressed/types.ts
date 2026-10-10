import type { ClnpCompressedContext } from '@/transport/network/types';

export interface CompressedContextRecord {
	context: ClnpCompressedContext;
	firstAt: number;
}

export interface CompressedChain {
	contextKey: string;
	firstAt: number;
	lastAt: number;
	deadline: number;
	family: number;
	flags: number;
	priority: number;
	data: Uint8Array;
	present: Uint8Array;
	covered: number;
	fragments: number;
	final: boolean;
	failure?: string;
}
