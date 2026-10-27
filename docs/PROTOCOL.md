# NEJE serial protocol (Master 2 family)

This document describes the USB serial protocol spoken by NEJE Master 2 engravers ("new" protocol,
firmware ≥ 7). It was reconstructed for interoperability by observing the official macOS control
app (NEJE 1.5.1) and verified against a **NEJE Master 2 Mini, firmware 7**.

Confidence markers:

- ✅ **verified on hardware**: sent to / captured from a real Master 2 Mini
- 🔍 **observed in the vendor app**: the exact bytes the official app builds, not yet exercised on hardware
- ❓ **inferred**: best understanding, may be wrong

The implementation lives in [`src/lib/protocol`](../src/lib/protocol). Its unit tests pin every
frame documented here.

## Link

| | |
|---|---|
| Physical | USB-serial (WCH CH340/CH9102, appears as `/dev/cu.wchusbserial*` or `COMn`) ✅ |
| Settings | 57600 baud, 8N1, no flow control, DTR asserted ✅ |
| Faster rate | The device offers a higher rate in its info frame (250000 on the Master 2 Mini). `FF AA 0A 06 01 <baud BE32> 55` switches, answered by `FF AA 0B 06 01 01 <baud BE32> 55` ✅. The device returns to 57600 when the port is reopened ✅. This app stays at 57600 because Web Serial cannot change speed without reopening. |
| Checksums | none |

## Framing

```
FF AA <len> <cmd> <sub> <payload…> 55
```

`len` is the length of the whole frame, header and trailer included. Multi-byte fields are
big-endian. The device emits a few garbage bytes after baud switches and port reopening ✅, so
parsers must resynchronise on `FF AA` and validate the trailer.

## Host → device

| Purpose | Frame | |
|---|---|---|
| Identify | `FF AA 08 01 01 5A A5 55` | ✅ |
| Set laser parameters | `FF AA 0B 03 01 <time> <power> <level> <sensitivity> <mode> 55` | 🔍 sent to hardware without error, effect not measured |
| Pause / resume / cancel | `FF AA 08 02 01 01 <00 \| 01 \| 02> 55` | 🔍 |
| Move head to (x, y) | `FF AA 10 05 01 50 01 <x BE16> <y BE16> FF FF FF FF 55` | ✅ head moves, no reply |
| Trace frame (pointer laser on) | `FF AA 10 05 01 50 02 <x> <y> <w₈> <h> 55` | 🔍 |
| Trace off | `FF AA 10 05 01 50 00 FF×8 55` | 🔍 |
| Start job | `FF AA 14 04 01 01 50 <x> <y> <w₈> <h> <bytes BE32> 55` | 🔍 |

- Coordinates are device pixels from the top-left; the pixel pitch is reported by the device (75 µm).
- `w₈` is the job width rounded up to a multiple of 8; `bytes = w₈ × h / 8`.
- `time` is the dwell per dot in ms. The vendor app encodes it as `(t + ⌊t/255⌋) & 0xFF`, the identity below 255.
- `level`, `sensitivity` and `mode` are device settings (idle pointer brightness, motion-detection
  sensitivity, speed mode). This app keeps whatever the device reports.

### Job upload 🔍

1. Send *start job*.
2. Wait for *job accepted* (`04 02`). `01` means go, anything else means busy.
3. Stream exactly `bytes` of bitmap data with no framing, in 2 KiB chunks.
   - Rows are bit-packed with 1 meaning burn. Even rows are MSB-first.
   - Odd rows are reversed (serpentine scan). The vendor app's odd-row bit table is
     `01 02 04 08 10 10 20 40`, which looks like a typo of the exact mirror `… 20 40 80`. This app
     defaults to the exact mirror and offers the vendor order under *Advanced* until a calibration burn settles it ❓.
4. The device reports *transfer complete*, then progress, then *finished*.

While the device is receiving bitmap data, every byte is image data, so a command sent mid-stream
would be read as pixels ❓. This app therefore stops an upload by padding the rest with zeros (no burn)
and only then sends *cancel*.

## Device → host

| `cmd` | Meaning | Layout | |
|---|---|---|---|
| `01` | Info | model `b5`, firmware `b7`, width `b8–9`, height `b10–11`, pixel pitch µm `b16`, max baud `b22–25`, feature flags `'Y'/'N'` at `b26–33` (heartbeat, –, battery, temperature, power, sensitivity, level, mode) | ✅ |
| `02` | Status | `b6`: 0 idle, 2 paused, other working | ✅ (idle) |
| `03` | Parameters | time `b5`, power `b6`, level `b7`, sensitivity `b8`, mode `b9` | ✅ |
| `04` | Job flow | `b5=02` accepted (`b6=01`), `b5=03` progress % in `b6`, `b5=04` transfer complete | 🔍 |
| `06` | Baud switched | ok `b5`, baud `b6–9` | ✅ |
| `0B` | Telemetry, about 1 Hz | temperature °C `b5`, battery % `b6`, charging mA `b7–8` (`FF` = unsupported) | ✅ |
| `0C` | Events | `b5`: 1 finished, 2 paused (low battery), 3 paused, 4 UI hint ❓ | 🔍 |
| `0D` | Head position | `b5='P'`, y `b6–7`, x `b8–9` | 🔍 |
| `00` | Unknown, sent once after identify | `FF AA 0F 00 01 0C 01 F6 54 C6 2A 08 82 9E 55` (serial number?) ❓ | ✅ |

### Captured identify response (Master 2 Mini, firmware 7)

```
FF AA 26 01 03 1A 01 07 05 BA 06 40 11 2E 12 C0 4B 19 00 08 00 00 00 03 D0 90 59 59 4E 59 59 59 59 59 59 04 00 55
FF AA 0C 03 02 07 50 0A 00 02 28 55          parameters: 7 ms, 80 %, level 10
FF AA 10 02 01 01 00 00 06 01 A1 05 B0 02 FD 55  status: idle
FF AA 0C 0B 03 18 FF FF FF 00 01 55          telemetry: 24 °C, no battery
```

Model ids: 22 Master 1, 23 Master 2, 24 Master 2 Plus, 25 Master 2 Max, **26 Master 2 Mini**,
27 Master 2S, 28 Master 2S Plus, 29 Master 2S Max, 30 Master 2S Mix. The older KZ, BL and Master 1
boards (ids 1–14) use a different 4-byte protocol, which this project does not implement.
