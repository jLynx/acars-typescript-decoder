/** Transport framing without loading application decoders or reference datasets. */
export { AcarsFramer, acarsCrc, oddParity } from './framing/framing';
export { decodeAcars as decodeFrame } from './framing/messages';
export type { AcarsReport } from './types';
