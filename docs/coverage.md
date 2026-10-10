# Decoding coverage

`decoded` applies to a supported payload layout. `partial` retains unsupported
fields or unverified application structure; label recognition alone is `unknown`.
This project is working toward the union of public decoders. It does not yet
implement every public format or establish superiority over other projects.

| Area             | Implemented                                                                                                                                     | Remaining                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ARINC 618        | Character envelopes, parity, block CRC, downlink/uplink/control, ETB/ETX                                                                        | Audio/IQ demodulation                                                                           |
| Airline text     | Airframes 1.9.2, documented movement/position/load/operations, SA weather bundles, label-5Z fields and narrow label-16/32/37 telemetry          | Unknown airline variants; weather tokens and proprietary columns                                |
| Labels           | 210 two-character entries from pinned Skyshark                                                                                                  | Labels do not establish payload semantics                                                       |
| ATS text         | AFN headers/application fields, TI2 ATIS request/delivery, OC1 oceanic request                                                                  | Application CRC verification; further message variants                                          |
| ADS-C            | Supported FANS contracts/reports, named scales/units, verified ARINC envelope                                                                   | Unknown tags/variants; ATN ADS-C v2                                                             |
| FANS CPDLC       | 183 uplink/129 downlink phrases, supported PER bodies, rates/fuel/souls, positions/tracks, predeparture, holds, six additional route structures | Remaining body/schema validation; malformed upstream regressions stay partial                   |
| MIAM             | CORE v1/v2 data/ack, ALO/ALR, CF F/K/S/A/Y/X controls, bounded files, verified addressed embedded application dispatch; MA and H1               | Additional application identifiers; negotiated pacing/state semantics                           |
| OHMA/RYKO        | Verified zlib/base64, outer/inner JSON, named fields, source/aircraft/conversation part assembly                                                | Encryption/signatures; proprietary units/dictionaries                                           |
| Streaming        | Bounded source sessions, snapshots for late arrivals, ACARS/MIAM/OHMA assembly states                                                           | Incremental protocol engines and richer expiry/duplicate events                                 |
| Receiver imports | Flat acarsdec/vdlm2dec and nested dumpvdl2/dumphfdl JSON, H1 metadata reconstruction, JSONL/capture replay CLI                                  | Additional receiver dialects                                                                    |
| VDL2 transport   | AVLC/FCS, inner ACARS BCS/parity, XID, X.25 modulo-8 reassembly, compressed/uncompressed CLNP headers, ES-IS common/ISH/redirect, IDRP/COTP     | CLNP/COTP reassembly, ESH address lists, further options/XID parameters, COTP integrity and ATN |
| HFDL transport   | SPDU/MPDU headers, individual LPDU CRCs, logon fields, HFNPDU headers, performance/frequency reports, embedded ACARS                            | Slot allocations, full system-table assembly, further variants and demodulation                 |
| SATCOM           | Normalized SATCOM-carried ACARS payloads                                                                                                        | Aero transport and DSP                                                                          |
| Aircraft reports | Airbus/Boeing DF/ACM/APM/KER identifiers, A350 MIAM report header, explicit event text                                                          | Aircraft-specific measurement dictionaries/scales                                               |
| Airports         | Optional offline OurAirports coded-airport snapshot                                                                                             | Live data and ATC address lookup                                                                |

Raw radio text and unknown bytes remain available. Binary ARINC values and MIAM
bodies are exposed only after their CRC verifies. MIAM and OHMA decompression is
bounded to 65,536 bytes and requires a complete stream. ATS text integrity remains
explicitly unverified. An AVLC or HFDL link CRC does not verify every inner layer.
The capture CLI accepts the viewer's null message-number/flight metadata as absent;
the programmatic API continues to require strings or omitted optional fields.
COTP currently exposes headers and raw application bytes with unverified integrity.
Derived CLNP fragments and X.25 packets with `more` set do not receive inner decoding.
The X.25 reassembler dispatches only completed user data. Its default limits are
64 channels, 8,192 payload bytes, 128 packets and sixty seconds from the first
packet; caller identities must isolate receiver, circuit and direction. Failed
sequences stay rejected until expiry/reset. CLNP header checksums are distinct
from COTP and application integrity; omitted CLNP checksums withhold inner dispatch.
X.25 has no explicit start-of-NSDU bit. Initialize/reset at a known circuit boundary;
a stream starting with a final fragment cannot establish whether a prefix was missed.

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

## Sources and validation

[upstreams.json](upstreams.json) records repositories, exact revisions, licenses,
source paths and local ports. Required notices are in
[THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt). Publicly visible GPL code is
not translated into this MIT distribution. Sources include MIT Airframes,
libacars, datalink and Skyshark, plus public-domain OurAirports.

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
(ISO 8473 CLNP), [RFC 995](https://www.rfc-editor.org/rfc/rfc995) (ES-IS common/ISH/RD)
and [ITU-T X.283 (12/97)](https://www.itu.int/rec/T-REC-X.283-199712-I/en)
for seconds-based ES-IS timer units. ESH address-list changes from the early RFC
remain raw. These readers do not redistribute the standards documents.

See [upstream-audit.md](upstream-audit.md) for the migration ledger and next work.
