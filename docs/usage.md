# Usage guide

Start with the [README quick start](../README.md#quick-start). For supported
formats, integrity checks and protocol limits, see [decoding coverage](coverage.md).

## Reassemble a source log

```ts
import { decodeLog, type AcarsRecord } from '@jlynx_/acars-decoder';

const blocks: AcarsRecord[] = []; // complete received envelopes from ONE source
const messages = decodeLog(blocks);
```

- Records require a unique positive `id`, millisecond `receivedAt`, registration,
  mode, acknowledgement, label, block ID, direction, text and ETB `continuation`
  flag. Include `messageNumber` and `flight` when received.
- Call separately for independent sources. Results are chronological copies;
  original `text` is preserved and the final block receives `assembledText`.
- Calls are stateless: pass the retained source log again as new blocks arrive.
  Missing blocks are never silently filled.
- Limits are 10,000 records, 8,192 characters per payload and up to 26 downlink
  or 24 uplink blocks. Reassembly allows two minutes between blocks and five
  minutes overall.

## Streaming sessions

`createDecoderSession()` retains isolated source windows and reinterprets them
on each push. Defaults are 16 sources, 512 records and 1 MiB of text per source
for 20 minutes. This favors consistency over incremental processing speed.

| Operation               | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `push(message, source)` | Return the arriving record and assembly results     |
| `snapshot(source)`      | Retrieve earlier records completed by late arrivals |
| `reset`                 | Clear retained state                                |
| `stats`                 | Report retained records and evictions               |

Receiver adapters preserve original objects, reconstruct stripped H1 metadata
and keep receiver error counts separate from locally verified integrity.

## Optional airport names

```ts
import { createDecoder } from '@jlynx_/acars-decoder';
import { airportName } from '@jlynx_/acars-decoder/airports';

const decoder = createDecoder({ airportLookup: airportName });
const atis = decoder.decode({ label: '5D', text: 'NZAA' });
```

The offline OurAirports snapshot contains 11,764 airports and is not imported by
the main entry point. A custom lookup can return a name or `undefined`; unknown
codes remain visible. Only explicitly identified airport fields are enriched.

## Custom formats

```ts
import { createDecoder, type AcarsPlugin } from '@jlynx_/acars-decoder';

const plugin: AcarsPlugin = {
	name: 'my-airline',
	decode(message) {
		if (message.label !== 'ZZ' || message.text !== 'HELLO') return undefined;
		return {
			title: 'Greeting',
			summary: 'Hello received.',
			coverage: 'decoded',
			fields: [],
			notes: [],
		};
	},
};

const decoder = createDecoder({ plugins: [plugin] });
```

- Plugins run synchronously in caller order before built-in results.
- Inputs are frozen envelope copies; outputs must match the interpretation shape.
- Exceptions and malformed results fall through.
- Log plugins receive assembled text where available; original envelopes and
  assembly notes remain preserved.

## Transport examples

Import from `@jlynx_/acars-decoder/framing` to load transport readers without
application decoders. These examples assume received byte arrays, not audio or IQ.

### ARINC 618 framing

`AcarsFramer.bit()` accepts demodulated bits, verifies parity and block CRC, and
passes parity-bearing bytes to a callback. `decodeFrame()` reads those bytes
without the BCS; by itself it checks parity/layout, not a missing block checksum.

### X.25 and CLNP

```ts
import { createX25Reassembler, createClnpReassembler } from '@jlynx_/acars-decoder/framing';

const network = createX25Reassembler({ maxChannels: 64, retentionMs: 60_000 });
const clnp = createClnpReassembler();
const result = network.push(verifiedX25Bytes, {
	link: 'receiver-1:aircraft-ABC123:ground-01:downlink',
	receivedAt: Date.now(),
});

if (result.status === 'complete' && result.network) {
	const assembled = clnp.push(result.payload!, {
		link: 'receiver-1:downlink',
		receivedAt: Date.now(),
	});
	if (assembled.status === 'complete') console.log(assembled.cotp ?? assembled.idrp);
}
```

Verify link CRC first and scope links by receiver, peers and direction. Initialize
X.25 at a known circuit boundary; a final fragment alone cannot prove a missing
prefix. CLNP headers must verify, and conflicting state is rejected until expiry/reset.

### Explicit COTP connections

```ts
import { createCotpReassembler } from '@jlynx_/acars-decoder/framing';

const cotp = createCotpReassembler();
cotp.open(
	{
		link: 'receiver-1:source-nsap:destination-nsap:connection-1:downlink',
		destinationReference: 0x1234,
		format: 'normal',
	},
	Date.now(),
);
const messages = cotp.push(completeNetworkUserData, {
	link: 'receiver-1:source-nsap:destination-nsap:connection-1:downlink',
	receivedAt: Date.now(),
});
for (const message of messages.assemblies) {
	if (message.status === 'complete') console.log(message.payload);
}
```

Open each direction with its negotiated format and a known message boundary.
New connections start at sequence zero; existing connections need the expected
sequence at a known TSDU boundary. Expiry loses that boundary and requires reopening.

### Passive COTP sessions

```ts
import { createCotpSession } from '@jlynx_/acars-decoder/framing';

const transport = createCotpSession({ maxRecords: 64, freezeMs: 60_000 });
const received = transport.push(completeCotpNsdu, {
	link: 'receiver-1:aircraft-ABC123:ground-01',
	direction: 'a-to-b',
	receivedAt: Date.now(),
});
for (const message of received.assemblies) {
	if (message.status === 'complete') console.log(message.connectionId, message.direction, message.payload);
}
```

Sessions observe class-4 CR/CC handshakes and open both directions at sequence zero.
Use consistent peer labels, a common receiver/peer-pair link and ordered timestamps.
Unsupported negotiation prevents opening; failed present checksums are rejected.

For ACK windows, expedited delivery, release handling, checksum profiles and
resource bounds, see [transport coverage](coverage.md). These are passive readers,
not active protocol engines, and do not verify ATN application integrity.

## Lower-level application readers

The `/formats` entry point provides readers for normalized records. They may
throw on malformed binary data and do not validate input or enrich airports.
Prefer the main `decode`/`decodeLog` API for applications.

- FANS readers expose ADS-C/CPDLC; the public dispatcher verifies ARINC CRC
  before exposing values. Standalone structural readers remain unverified.
- ATN readers require explicit direction/context where applicable. Structural
  completeness does not establish full semantics; protected content stays opaque.
- `decodeMetar` retains units, raw observations and unsupported weather tokens.
- `decodeRtr` retains XML paths, raw values and the original document. Verified
  MIAM exposes it through `embedded.maintenance`; proprietary meanings remain
  partial. See [observed report support](capture-formats.md).
