import schema from '@/payload/protocols/atn/b2/schema.json';
import { schemaWire, find } from '../cpdlc-wire';

export const nodes = schema.nodes;
export const roots = [
	['ATCUplinkMessage', 'uplink', 'application', 'cpdlc'],
	['ATCDownlinkMessage', 'downlink', 'application', 'cpdlc'],
	['ProtectedGroundPDUs', 'uplink', 'protected', 'cpdlc'],
	['ProtectedAircraftPDUs', 'downlink', 'protected', 'cpdlc'],
	['ADSRequestContract', 'uplink', 'application', 'adsc', 'request'],
	['ADSReport', 'downlink', 'application', 'adsc', 'report'],
	['ADSAccept', 'downlink', 'application', 'adsc', 'accept'],
	['ADSReject', 'downlink', 'application', 'adsc', 'reject'],
	['ADSNonCompliance', 'downlink', 'application', 'adsc', 'noncompliance'],
	['ADSPositiveAcknowledgement', 'downlink', 'application', 'adsc', 'positiveAcknowledgement'],
	['ADSGroundPDUs', 'uplink', 'protected', 'adsc'],
	['ADSAircraftPDUs', 'downlink', 'protected', 'adsc'],
];
const reachable = new Set();
function visit(type) {
	if (reachable.has(type)) return;
	reachable.add(type);
	if (nodes[type].type) visit(nodes[type].type);
	for (const member of nodes[type].members ?? []) visit(member.type);
}
roots.forEach(([type]) => visit(type));
export const entries = [...reachable].map((type) => [type, nodes[type]]);
export const wire = (target, override, maximum = false) => schemaWire(nodes, roots, target, override, maximum);
export { find };
