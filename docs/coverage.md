# Decoding coverage

This is a combined decoder with explicit gaps, not a universal ACARS decoder.
`decoded` applies to a supported payload layout; `partial` preserves unsupported
fields or unverified application structure. Label recognition alone remains
`unknown`. Source labels may have multiple airline uses.

| Area         | Current coverage                                                                                                | Remaining gaps                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ARINC 618    | Character envelopes, parity, block CRC, downlink/uplink/control, ETB/ETX                                        | Radio demodulation and transport protocols                                                                        |
| Airline text | Airframes 1.9.2 formats plus documented movement, position, load, operations, free text and tagged messages     | Unseen/proprietary airline layouts                                                                                |
| Labels       | All 210 two-character entries in pinned Skyshark catalogue                                                      | Labels do not define every payload                                                                                |
| ADS-C        | Supported uplink contracts/downlink reports with scales, units and CRC-verified ARINC 622 envelope              | Unknown tags/variants remain partial                                                                              |
| FANS CPDLC   | 183 uplink/129 downlink phrase catalogue, supported PER parameters, position reports, routes and errors         | Predeparture clearance, additional route structures and other unsupported parameter bodies; ATN ASN.1 is separate |
| MIAM CORE    | v1/v2 data and acknowledgements, ASCII85/plaintext, raw DEFLATE, CRC32/CRC16                                    | ALO/ALR negotiation, file transfers, separate application interpretation                                          |
| OHMA/RYKO    | Base64/zlib outer and inner JSON, named flight/event/parameter values                                           | Application conversation reassembly, encrypted/signed content, proprietary parameter units/definitions            |
| DF/ACM       | Supported Airbus/other report headers, event text, route and registration; safe fragment association/reassembly | Numeric measurement dictionaries and scales                                                                       |
| Airport data | Optional full coded-airport OurAirports snapshot; ICAO/IATA lookup                                              | Uncoded airports, live updates and ATC address resolution                                                         |

All transfers preserve raw text. Binary ARINC applications are interpreted only
after their application CRC passes. MIAM bodies are exposed after the appropriate
body CRC verifies; DEFLATE must terminate without trailing input and output is
limited to 65,536 bytes. OHMA verifies zlib integrity, retains the inner JSON and
does not assign unknown units. Generic ACARS reassembly is separate from OHMA's
conversation-part protocol.

## Sources and provenance

| Source                                                                                                            | Reuse / comparison                                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Airframes TypeScript decoder](https://github.com/airframesio/acars-decoder-typescript) 1.9.2, MIT                | Runtime airline-format dependency; representative regression fixtures                                         |
| [xoolive/datalink](https://github.com/xoolive/datalink), MIT, revision `d3e3e5a5d2bda04fbee83832cb77e3050a87364c` | Rust FANS catalogue, supported PER layouts, ADS-C fixtures and OHMA JSON format/fixture                       |
| [libacars](https://github.com/szpajder/libacars), MIT                                                             | C ADS-C scales, ARINC CRC and reassembly rules; CORE v1/v2 wire fields, raw DEFLATE and ARINC CRC polynomials |
| [Skyshark](https://github.com/ckuethe/skyshark), MIT, revision `3d66e7d27ce5b9616643faa8a3b29ca9801b9007`         | Python label catalogue and documented text layouts                                                            |
| [OurAirports](https://ourairports.com/data/), public domain                                                       | 10 October 2026 snapshot: 11,764 airports / 10,531 ICAO / 9,051 IATA codes                                    |

The label generator pins its source revision and records SHA-256. Airport metadata
records the exact source hash and counts. Full MIT notices are retained in
`THIRD_PARTY_NOTICES.txt` and fixture notices alongside tests. The libacars sources
were reviewed as protocol references; broad C ASN.1 decoder coverage has not been
ported. A Rust route fixture with a failed application CRC is retained as a
rejection regression, not evidence that a complete route decoded successfully.

Additional Python/Go/C projects were inspected. Implementations without a verified
license are not copied. AFN and ATN, MIAM file/session transfers and proprietary
maintenance dictionaries are explicit future work. Porting a function is not
enough: it must have validated semantics, licensed provenance and regression tests.

## Next coverage work

- MIAM embedded application dispatch, negotiation and file-transfer lifecycle.
- OHMA conversation assembly with source isolation, expiry and integrity checks.
- AFN logon/contact/application reports with verified CRC and licensed fixtures.
- Remaining FANS PER bodies and ATN CPDLC through verified ASN.1 schemas.
- Public, licensed aircraft-report specifications for DF/ACM measurements.
- Differential corpus comparisons, fuzzing and reproducible performance baselines.

No corpus measurement currently establishes superiority over every other decoder.
