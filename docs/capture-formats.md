# Observed aircraft-report readers

These readers independently extract literal identifiers and delimiters from the
October 2026 captures. They are partial format recognition, not a port of a
verified aircraft measurement dictionary. Sanitized header layouts and synthetic
bodies are in `test/payload/protocols/reports/capture-variants.spec.js` and
`parameters.spec.js`; RTR XML tests are in `rtr.spec.js`. The original captures are
private and excluded from packages.

| Layout                                                                                 | Current extraction                                                                              | Unverified content                                                             |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `<id>AER9` followed by aircraft/flight, two six-digit codes and adjacent ICAO airports | Report ID/code, registration, flight code, route, raw date/time codes                           | Remaining header and numeric body                                              |
| `<id>HEG9` with route before a five-character header code and date/time codes          | Report ID/code, registration, flight code, route, raw header/date/time codes                    | Equipment/configuration fields and numeric body                                |
| `<id>KER` / `<id>KER9` with `ER` / `TO` header                                         | Report ID/code, registration, flight code, route, raw phase/date/time/suffix fields             | Meaning of phase/suffix codes and numeric body                                 |
| `APU1` followed by `ICAO/ICAO/`                                                        | Literal report code and route                                                                   | Numeric columns, scales, units and specific report semantics                   |
| H1 `T5`, `/address.TOFnnn` followed by airline/aircraft/flight/date/time/route fields  | Routing address, literal report code, registration, flight, route; other header fields kept raw | Meaning of TOF/report number, separator, compact dates, encoded body and units |
| `A380nnnnnn,n,n,TBnnnnnn;` followed by numeric content without `REP`                   | Aircraft type and raw configuration prefix                                                      | Report ID, application part numbering, route, date/time and body               |
| `PRddddd.ddddd.ddd,value` with semicolon delimiters                                    | Literal parameter identifier and transmitted numeric string                                     | Equipment parameter name, scale, unit and integrity                            |

No UTC date, timezone or measurement unit is assigned to the newly observed compact
headers. Flight leading zeroes, signs and decimal precision are retained. Unknown
numeric fields remain in the original text. A blank H03 does not supply event text.

PR extraction displays at most 64 records per block/assembly. An ETB block's last
value is withheld unless followed by a semicolon: an apparently valid number may
still continue in the next transmission. Complete radio reassembly can reconstruct
split records only when every consecutive block and final ETX is available.
Repeated identifiers remain separate records. Malformed or leftover content stays
raw, and recognition never upgrades these formats to fully decoded.

Header context can be shown on DF and T5 continuation blocks within the same
receiver source, aircraft, mode, application sublabel, message-number prefix and
two-minute window, with conflicting flights rejected. This association is separate
from complete radio assembly. A different prefix such as U67 cannot inherit U66's
report ID merely because its content appears related.

## Public-source investigation

The 09:30 UTC capture also supplies four complete H1/CF RTR XML reports inside
three-block MIAM transfers. Each transfer assembles and CRC-verifies, then the
RTR reader extracts 27 fields: CMS/aircraft/route/transfer identifiers, transmitted
NFDE/MM descriptions/codes and system attributes. `decodeRtr(text)` exposes typed
paths and raw values; H1/CF display fields and MIAM `embedded` results use the same
reader. Dates/timezones, `STA`, `FCL`, `FPH`, `CB`, `hdi`, `fo`, `occ`, BITE and
side meanings remain unverified. A reported description is not a derived diagnosis.
XML has no application integrity check; MIAM's verified CRC remains a separate
envelope result. Overall coverage therefore stays partial even though more fields
are available. The complete ten-block ACM 55TR in that capture also assembles;
its numeric body still needs a matching aircraft dictionary. Empty label-5V
advisories and intermediate fragments retain their current unknown coverage.

The RTR reader bounds text to 8,192 characters, 256 XML elements, depth 16 and
128 extracted fields. It accepts the observed XML subset with quoted attributes
and standard/numeric character entities. Complete documents are required; DTDs,
external entities, processing instructions, comments, CDATA and namespaces are
unsupported. Duplicate singleton fields/attributes, invalid characters, incomplete
tags and resource excess withhold extraction while the original payload remains
available. Unknown elements/attributes remain in the raw XML, without interpretation.
Fixtures use synthetic aircraft identifiers and descriptions; no private report
body is redistributed.

Targeted RTR research on 10 October 2026 found no matching schema or verified
flag dictionary in the pinned Airframes, datalink or libacars sources. libacars's
`acars.c`/`miam-core.c` preserve or optionally pretty-print XML. Airframes' public
[CF notes](https://github.com/airframesio/acars-message-documentation/blob/d2a44817ae0a059603c816ae737b02e7730983bd/research/H1/CFB.md)
and [CFB.01 analysis](https://github.com/airframesio/acars-message-documentation/blob/d2a44817ae0a059603c816ae737b02e7730983bd/research/H1/CFB/CFB.01.md)
describe other CF text layouts; their phase mappings are not applied to RTR.
GitHub repository/issue and web searches for HEADRTR, IDCMS, NFDE and RTR did not
locate matching semantics. GitHub code search required authentication and grep.app
returned a security checkpoint, so this is not an exhaustive code-search result
or evidence that the mappings cannot exist. No source content was copied from
those research notes.
The pinned GPL dumpvdl2 revision `686e87f2294ef6275855ba7364bd4bb9a0f8f56a`
delegates ACARS parsing/reassembly to libacars in `src/acars.c`; its inspected
ACARS parser/formatter paths did not add a separate RTR mapping.

- Existing pinned Airframes 1.9.2 plugins/corpus, datalink and libacars snapshots
  contain no matching T5/TOF, T6, APU1, AER9/HEG9/KER9 measurement decoder found in
  this investigation. Their presence in the upstream manifest does not imply these
  formats are implemented.
- Airframes message documentation, revision
  `d2a44817ae0a059603c816ae737b02e7730983bd`, was read for
  [DF research](https://github.com/airframesio/acars-message-documentation/blob/d2a44817ae0a059603c816ae737b02e7730983bd/research/H1/Sublabel_DF.md)
  and Jetstar load-report notes. It describes other examples and leaves many
  numeric meanings uncertain; it does not supply the missing dictionaries for
  these captures. No documentation content was copied into the implementation.
- The Java project Nicnick-Xia/ACARS-Parser, revision
  `2018a580d0aa5c70a1e5ba5668e727d64d963f61`, was inventoried. No explicit license
  or target-format source paths were identified. No code, data or fixtures were
  imported from it.

Remaining work includes the encoded T5/TOF and T6 bodies, aircraft-specific
measurement dictionaries, integrity rules and verified application-part assembly.
Missing radio blocks remain absent data; speculative concatenation does not repair
them. The current capability summary is in [coverage.md](coverage.md).
