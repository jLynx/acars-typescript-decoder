export interface MiamBody {
	version: number;
	applicationType: number;
	application: string;
	compression: number;
	encoding: number;
	checksum: number;
	length?: number;
	headerLength: number;
}
export interface InflateState {
	ended: boolean;
	strm: { avail_in: number };
}
