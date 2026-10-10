# Decoding coverage

`decoded` applies to a supported payload layout. `partial` retains unsupported
fields or unverified application structure; label recognition alone is `unknown`.
This project is working toward the union of public decoders. It does not yet
implement every public format or establish superiority over other projects.
Importing an upstream corpus or adding a protocol reader does not establish
complete application coverage; captured examples still need end-to-end field checks.

| Area             | Implemented                                                                                                                                                                                                                         | Remaining                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARINC 618        | Character envelopes, parity, block CRC, downlink/uplink/control, ETB/ETX                                                                                                                                                            | Audio/IQ demodulation                                                                                                                                                                                    |
| Airline text     | Airframes 1.9.2, documented movement/position/load/operations, SA weather bundles, label-5Z fields and narrow label-16/32/37 telemetry                                                                                              | Unknown airline variants; weather tokens and proprietary columns                                                                                                                                         |
| Labels           | 210 two-character entries from pinned Skyshark                                                                                                                                                                                      | Labels do not establish payload semantics                                                                                                                                                                |
| ATS text         | AFN headers/application fields, TI2 ATIS request/delivery, OC1 oceanic request                                                                                                                                                      | Application CRC verification; further message variants                                                                                                                                                   |
| ADS-C            | Supported FANS contracts/reports, named scales/units, verified ARINC envelope                                                                                                                                                       | Unknown tags/variants; ATN ADS-C v2                                                                                                                                                                      |
| FANS CPDLC       | 183 uplink/129 downlink phrases, supported PER bodies, rates/fuel/souls, positions/tracks, predeparture, holds, six additional route structures                                                                                     | Remaining body/schema validation; malformed upstream regressions stay partial                                                                                                                            |
| MIAM             | CORE v1/v2 data/ack, ALO/ALR, CF F/K/S/A/Y/X controls, bounded files, verified addressed embedded application dispatch; MA and H1                                                                                                   | Additional application identifiers; negotiated pacing/state semantics                                                                                                                                    |
| OHMA/RYKO        | Verified zlib/base64, outer/inner JSON, named fields, source/aircraft/conversation part assembly                                                                                                                                    | Encryption/signatures; proprietary units/dictionaries                                                                                                                                                    |
| Streaming        | Bounded source sessions, snapshots for late arrivals, ACARS/MIAM/OHMA assembly states                                                                                                                                               | Incremental protocol engines and richer expiry/duplicate events                                                                                                                                          |
| Receiver imports | Flat acarsdec/vdlm2dec, nested dumpvdl2/dumphfdl, JAERO native/JSONdump, H1 metadata, empty ACKs, JSONL/capture replay CLI                                                                                                          | Further receiver dialect inventory and replay                                                                                                                                                            |
| VDL2 transport   | AVLC/FCS, XID fields, X.25, uncompressed/context-bound compressed CLNP assembly, X.233 options, ES-IS, IDRP bodies/RD_PATH/security, passive class-4 COTP negotiation/DT/ED/AK/EA/DR/DC/ER, QoS/selective ACK and ISO/ATN checksums | Mobile SNDCF edition/circuit groups/Deflate; class fallback/full COTP flow and missing-capture inference; further ES-IS/XID/IDRP options/authentication; independent ATN checksum audit and applications |
| HFDL transport   | SPDU/MPDU/LPDU CRC/headers, logon/HFNPDU/reports/ACARS, bounded multipart system-table assembly, coordinates/frequencies/station slots and version selection                                                                        | SPDU slot allocation codes, further table/transport variants and demodulation                                                                                                                            |
| SATCOM           | Normalized ACARS, demodulated Aero R/P/T SU CRC and bounded ACARS assembly, satellite ACARS parity/BCS, selected assignment/bitrate/frequency controls                                                                              | Further documented control/channel variants and DSP                                                                                                                                                      |
| Aircraft reports | Airbus/Boeing DF/ACM/APM/KER identifiers, A350 MIAM report header, H1/CF RTR XML fields through verified MIAM, explicit event text                                                                                                  | Aircraft-specific measurement dictionaries/scales; full RTR schema/status semantics                                                                                                                      |
| Airports         | Optional offline OurAirports coded-airport snapshot                                                                                                                                                                                 | Live data and ATC address lookup                                                                                                                                                                         |

Raw radio text and unknown bytes remain available. Binary ARINC values and MIAM
bodies are exposed only after their CRC verifies. MIAM and OHMA decompression is
bounded to 65,536 bytes and requires a complete stream. ATS text integrity remains
explicitly unverified. An AVLC or HFDL link CRC does not verify every inner layer.
The capture CLI accepts the viewer's null message-number/flight metadata as absent;
the programmatic API continues to require strings or omitted optional fields.
COTP exposes headers and raw application bytes, verifying each complete TPDU's
ISO 8073 checksum when present; this does not verify ATN application integrity.
Derived CLNP fragments and X.25 packets with `more` set do not receive inner decoding.
The X.25 reassembler dispatches only completed user data. Its default limits are
64 channels, 8,192 payload bytes, 128 packets and sixty seconds from the first
packet; caller identities must isolate receiver, circuit and direction. Failed
sequences stay rejected until expiry/reset. CLNP header checksums are distinct
from COTP and application integrity; omitted CLNP checksums withhold inner dispatch.
X.25 has no explicit start-of-NSDU bit. Initialize/reset at a known circuit boundary;
a stream starting with a final fragment cannot establish whether a prefix was missed.

The uncompressed CLNP reassembler accepts verified headers and arbitrary segment
offset order, suppresses identical overlaps/retransmissions and withholds gaps.
Conflicting overlaps, total lengths, flags or option bytes reject the message
until expiry/reset. Route-dependent option differences are conservatively rejected;
route-record merging is not implemented. Caller network scopes, both NSAPs and
PDU IDs isolate state. Default limits are 64 messages, 8,192 payload bytes each,
128 fragments adding bytes and sixty seconds from first reception, further
bounded by every segment's remaining lifetime. Retained complete messages suppress
duplicates until expiry. Payload storage uses a byte-presence map of equal size;
failed messages free both buffers. Output preserves the received PDU separately
from assembled bytes and does not synthesize a checksum. CLNP does not protect
payload bytes; COTP verification covers its LI, header and user data. Missing
checksums or unparsed trailing TPDUs keep aggregate COTP integrity unverified.

Passive class-4 COTP DT reassembly requires an explicitly opened directional
connection, negotiated normal/extended format and a known TSDU start sequence.
Sequence numbers continue across messages and wrap modulo 128 or 2^31. In-window
out-of-order packets wait for missing predecessors; EOT ends a message. Every
TPDU in a received NSDU must verify before any data is accepted. Corrupt NSDUs
are discarded without changing accepted data. Conflicting duplicate bytes/EOT
reject the connection until expiry/reset/open. Defaults are 64 connections,
64 KiB pending data plus up to 64 KiB duplicate-history bytes per connection,
128 pending DTs, a 32-sequence window (configurable to 63), and sixty seconds
from the first pending packet or last accepted idle data/duplicate. Duplicates
cannot extend a pending-message timeout. Expired connections lose their known
boundary and must be reopened. Active acknowledgement/flow control,
ISO checksum-omitted connections remain unsupported in the explicit assembler.
Caller-established ATN checksum profiles are supported; ATN applications are not.
Incomplete normal-format messages cannot span a whole sequence cycle; exhausting
128 sequence numbers without EOT rejects the connection before ambiguous reuse.

Connections explicitly declaring negotiated expedited service also deliver ED
messages in their independent normal/extended sequence space. ED requires EOT
and 1–16 bytes, with pending/history storage additionally bounded by 16 times
the sequence window each. Output names the service; use the automatic session
for EA tracking and negotiated cross-service delivery ordering. Conflicts in either stream clear
both buffers and reject the connection. A verified DR/DC closes directional
state only when its destination and declared peer reference match; the returned
`closed` event reports fragments discarded and frees normal/expedited storage.
This is passive release handling, not a full release handshake engine.

`createCotpSession()` additionally matches captured class-4 CR/CC handshakes and
automatically starts both directional DT/ED streams at zero. Use one receiver/peer
pair `link`, explicit `a-to-b`/`b-to-a` direction and ordered reception times. It
validates nonzero peer references, version 1, normal/extended and expedited selection,
ordinary TPDU size (128–8192 bytes), preferred maximum TPDU size, optional selector
echoes and complete ISO checksums. Preferred size uses one-to-four-byte unsigned
big-endian values multiplied by 128 bytes. The responder can select a preferred
value no larger than the request or fall back to the ordinary size independently.
A preferred-size CC requires a preferred-size CR and must omit ordinary size C0.
All positive four-byte values are retained accurately. `maxNsduBytes` configures
the local input bound in header decoding, sessions and explicit reassembly:
default 8192, maximum 65535 bytes. It never overrides selected TPDU size or local
message/fragment limits.
Initial credits seed directional advertised windows. AKs update lower/upper edges,
credit and subsequences using modular ordering; stale updates cannot replace the
current window, while FCC matches the opposite retained window. Acknowledgement
events report the data direction and whether the cumulative edge is covered by
observed contiguous data. They never fill capture gaps or advance receive chains.
DT `transmission` reports the advertised window, membership and pending blocking EA.
These are capture observations; DTs are assembled using the bounded local window
even when an uncaptured peer AK may explain an advertised-window discrepancy.
Per-peer acknowledgement/inactivity indications remain in milliseconds, separately
from capture expiry. ROA selection cannot enable an unoffered option.
Unsupported negotiation parameters retain raw bytes and do not establish
state. Mutually selected ISO checksum omission is accepted by sessions, with
explicit unverified integrity; failed present checksums are always rejected.
Address-bound ATN profiles are retained independently of ISO verification.
Retransmission comparison permits reordered parameter TLVs and equivalent 0/255
checksum encoding. All duplicate TLVs remain in wire order in `parameters`; the
last occurrence of each ID governs negotiation and checksum length. Full-TPDU
verification still covers every byte, including superseded TLVs. Retransmission
comparison uses effective values, so equivalent earlier occurrences do not conflict.
Per-peer QoS/protection fields and negotiated selective ACK ranges are retained.
Selective ranges support normal/extended wrap, cumulative trimming and bounded
retention. Class selection/fallback and complete sender/receiver procedures remain
outstanding.

EA events match the observed outstanding ED in the opposite data direction.
New EDs do not replace an ED awaiting EA; duplicate acknowledged EDs do not reopen
that wait. Negotiated non-blocking DT ED-sequence dependencies hold delivery until
the referenced ED is delivered, then release complete TSDUs in order. Missing EDs
remain bounded pending state; an EA alone does not supply their payload.
Blocking TS-user request order cannot be inferred from network packet order.

Session results name connection generations and directions for assemblies.
Connect user data stays raw, separate from DT/ED messages. A matching DR/DC,
reassembly rejection or expired pending message closes both directions and frees
their buffers. Release events retain reason/user data and distinguish DR requests,
reversed DC confirmation, crossed DRs, pending-CR refusal/cancellation, unmatched
DC and duplicate controls during quarantine. They never generate responses.
Pending deadlines span both services/directions and cannot be
extended by traffic elsewhere. Idle expiry follows accepted data/duplicates.
Defaults are 64 total pending/established/frozen records, sixty-second handshake,
pending-message and idle timeouts, and sixty-second reference quarantine after
closure. Quarantine is a local capture policy, not a negotiated protocol lifetime;
record limits refuse new requests rather than evict frozen references. Use
`reset(link)` at a known capture boundary to clear state and quarantine. The API
generates no packets. ER exposes cause/rejected-header evidence, releases pending
requests and retains established connections until an observed release. Active
retransmission timers, complete flow/release procedures and inference across
missing dependencies remain outstanding.
ISO verification does not establish ATN application integrity.

ES-IS now reads modern ESH counted source NSAP lists and the ISH end-system
configuration timer with seconds, adapted from pinned permissively licensed
NetBSD code. ESH address bytes and unknown options remain raw; coverage stays
partial. Default counted-list parsing rejects malformed/truncated NSAPs/options.
Explicit `legacy-single` and `raw` ESH modes support the older RFC layout and
uninterpreted variants. Failed checksums withhold addresses; omitted checksums
remain explicitly unverified. X.25 dispatch uses the modern counted-list mode.

MIAM files are bounded to 64 KiB/999 segments/fifteen minutes; OHMA conversations
to 64 KiB/256 parts/twenty minutes. Each supports up to 128 active assemblies per
batch. Conflicting OHMA parts remain rejected until expiry. Generic radio assembly
permits at most 26 downlink or 24 uplink blocks and 8,192 characters. Uplink captures
starting mid-message cannot prove a missing prefix because the link has no message
start identifier. Session eviction can discard incomplete assemblies.

Observed seven-column label-10 POS and APM/KER headers from the user's October
capture remain partial. Compact coordinates, date/time codes and numeric columns
are retained without invented scales or units. Exact final retransmissions keep
the previously completed radio assembly within its time window.

Capture regressions now dispatch CRC-verified downlink CC1 connection confirmations
to the FANS decoder, including named dM73 version numbers. The Rust control fixture
only asserted the wrapper kind; that did not detect the previously missing body
dispatch. libacars dispatches CC1 to its FANS parser. Incompatible uplink CC1 bodies
remain raw. CR1 uplink-PDU dispatch and empty DR1 handling are unchanged.

Later capture readers now extract AER9/HEG9/KER9 header variants, APU1 routes,
T5/TOF header identifiers, Airbus configuration-only parts and explicit PR
identifier/value records. They remain partial: compact dates, body meanings,
measurement units and application integrity are unverified. DF/T5 continuation
context is isolated by sublabel and source. ETB PR values require a closing delimiter
before exposure. See [capture-formats.md](capture-formats.md) for layouts, provenance
and limitations.

Remaining priorities include encoded T5/TOF and T6 bodies; application-level Airbus
parts across different message numbers; and licensed measurement dictionaries.
An A380 configuration prefix without REP/H01/H02 does not establish a report ID or
justify inheriting another message's header. Missing ACARS blocks remain capture
gaps even when a format parser is available.

Compressed CLNP contexts can be explicitly registered or observed from verified
uncompressed option-5 packets. Priority/version/security/NSAPs remain scoped to
the caller's directed link. Offset assembly requires verified link integrity and
retains gaps/conflicts with bounded state. Mobile SNDCF circuit groups and Deflate
contexts require a usable edition-specific source before implementation.

X.233 options expose route/QoS/security and discard fields; IDRP exposes bounded
Open/Update/Error bodies, RD_PATH and ATN security labels with raw authentication.
XID adds sequencing/refusal/modulation/autotune/station fields; raw timer encodings
and unknown masks remain partial. ATN COTP integrity is separately address-bound,
retained through sessions and explicit assembly, and rejects profile downgrades.
The upstream 16-bit checksum routine is marked untested; mathematical fixtures
do not complete the independent specification/capture audit.

HFDL system tables assemble CRC-verified LPDUs, exposing station coordinates, BCD
frequencies and station slots, with bounded source-isolated version selection. A
contradictory later fragment withdraws a selected version. Aero accepts demodulated
R/P/T SUs and selected control fields, with bounded multipart assembly and strict
satellite ACARS parity/BCS decoding. Unsupported controls remain raw; no RF/DSP
coverage is claimed. JAERO adapters retain native/nested metadata and explicit
or source-derived directions; unknown native directions stay unknown.

## Sources and validation

[upstreams.json](upstreams.json) records repositories, exact revisions, licenses,
source paths and local ports. Required notices are in
[THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt). The combined distribution is
GPL-3.0-or-later, including ports from dumphfdl, dumpvdl2 and Wireshark. Original
MIT/BSD/IBM notices remain applicable to their source material. Other sources
include MIT Airframes, libacars, datalink, Skyshark and JAERO, BSD/IBM NetBSD,
and public-domain OurAirports. The original repository MIT notice is retained in
[MIT-LICENSE.txt](MIT-LICENSE.txt).

The Airframes corpus contains 308 extracted cases/3,316 assertions; 304 installed
plugin cases run. Four test-subclass cases are inventoried but not executable
through the published dependency. General utilities and remaining upstream test
infrastructure still need migration. Another 340 Rust JSON fixtures are retained;
ported checks include all 13 application cases, ADS-C message envelopes and the
260-PDU shallow CPDLC corpus. That shallow test requires over 200 complete decodes
in at least one direction; it does not prove the correct direction or all semantics.
Some upstream fixtures fail application integrity or schema constraints and are
retained as divergences, not successful-decoding evidence.

Static importers read downloaded tests as syntax/data. A separate verifier checks
all imported test-file hashes against the pinned public commits. Independent CRC
encoders and schema-based bit encoders exercise transport boundaries and malformed
data. Deterministic mutation tests are useful regression checks, not a sustained
fuzzing campaign. Benchmarks are local measurements, not comparative rankings.

The public dispatcher also runs all 304 runnable Airframes cases through a display
comparison. It checks nested results, known field aliases, JSON structural equality,
wire-preserved flight codes and explicit integrity refusals. The current comparison
has no unresolved expected display fields; this does not establish complete typed
semantic equivalence or correctness of upstream interpretations. Benchmark output
separates a warmed corpus, synthetic cache misses and bounded session replay.

Independent network readers use [RFC 994](https://www.rfc-editor.org/rfc/rfc994)
(ISO 8473 CLNP), [RFC 995](https://www.rfc-editor.org/rfc/rfc995) (ES-IS common/ISH/RD),
[RFC 905](https://www.rfc-editor.org/rfc/rfc905) (ISO 8073 checksum, passive negotiation and DT/ED reassembly),
[ITU-T X.224 (11/1995)](https://www.itu.int/rec/T-REC-X.224-199511-I/en)
(preferred maximum TPDU size encoding and negotiation),
and [ITU-T X.283 (12/97)](https://www.itu.int/rec/T-REC-X.283-199712-I/en)
for seconds-based ES-IS timer units. Modern ESH lists and ISH configuration timer
use [NetBSD ES-IS](https://github.com/NetBSD/src/blob/8c101a16ae09856a61284f770c2099b38186fe7c/sys/netiso/esis.c)
with BSD/IBM notices preserved. These readers do not redistribute the standards documents.

See [upstream-audit.md](upstream-audit.md) for the migration ledger and next work.
See [completion-roadmap.md](completion-roadmap.md) for the remaining support and
validation work, and the criteria for a defensible comparison with other libraries.
