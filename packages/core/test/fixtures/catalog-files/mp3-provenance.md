# Original MP3 acceptance fixtures

Generated locally on 2026-10-11 from original synthetic signals using the installed FFmpeg 9.0.1 and its libmp3lame encoder. No third-party music, source code or media was copied. The encoder is a fixture-generation tool; it is not a shipped runtime dependency. The repository's existing license applies to these original fixtures.

All three files use MPEG-1 Layer III, 128 kbps, 48 kHz mono, `-write_xing 0 -id3v2_version 3`. Each is 32,684 bytes. Audio payloads include MP3 encoder padding; the expected melody timing refers to the original PCM, with the reviewed 0.15-second onset/end tolerance.

| File | Original signal | SHA-256 |
| --- | --- | --- |
| melody-220-440.mp3 | One second of 220 Hz followed by one second of 440 Hz; native sine source | 9523d0a3a0a21c01b53d331e19bc958893a548efc0a34f92cffbf0467394e6e6 |
| silence.mp3 | Two seconds of zero-valued mono samples | 63729db01376915913a1c5e4f3d6e5f5b45d6d0656422c65ac420a8b4f570d7a |
| quiet-noise.mp3 | Two seconds of seeded noise, amplitude 0.001, seed 123 | 5c2473be715562e3cb2653bdc464b13c6d7378e8526a22e333b7d605d9140c78 |

Generation inputs were `sine=frequency=220:sample_rate=48000:duration=1` and `sine=frequency=440:sample_rate=48000:duration=1`, concatenated with `[0:a][1:a]concat=n=2:v=0:a=1[out]`; `anullsrc=r=48000:cl=mono:d=2`; and `anoisesrc=sample_rate=48000:duration=2:amplitude=0.001:seed=123` respectively. Each output was encoded with `-c:a libmp3lame -b:a 128k -ar 48000 -ac 1` and the options above.

These files establish provenance and known input signals. Header preflight, mocked decoder lifecycle and direct PCM tests do not prove actual MP3 decoding, browser note preview or exported MIDI acceptance. Those checks are recorded separately when executed.

An additional original pagination fixture, `alternating-30-notes.mp3`, contains thirty seconds of 0.125-amplitude sine tones, alternating 220 and 440 Hz in one-second intervals. It is 480,428 bytes with SHA-256 `bfe20dec27f94d5893e3794e75500dc92d891e0b7d76b102fad5179ab4ffb389`. It was generated using the same installed FFmpeg and output encoding settings, with this exact input:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi -i 'aevalsrc=0.125*sin(2*PI*if(lt(mod(t\,2)\,1)\,220\,440)*t):s=48000:d=30' -c:a libmp3lame -b:a 128k -ar 48000 -ac 1 -write_xing 0 -id3v2_version 3 packages/core/test/fixtures/catalog-files/alternating-30-notes.mp3
```

This signal supplies an independent thirty-note oracle for actual browser pagination and full saved report/MIDI checks; those checks remain separate from fixture creation.
