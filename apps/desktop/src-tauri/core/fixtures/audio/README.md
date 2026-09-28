# Audio decoding fixtures

Synthetic test tones made for execs with FFmpeg 7.1's `lavfi` sine source; they
contain no third-party recordings.

- `tone-880hz-48k-stereo.mp3`: 0.4 s, 880 Hz, 48 kHz stereo, LAME 64 kb/s.
  `ffmpeg -f lavfi -i "sine=frequency=880:duration=0.4" -ar 48000 -ac 2 -b:a 64k -map_metadata -1 tone-880hz-48k-stereo.mp3`
- `tone-660hz-opus.ogg`: 0.3 s, 660 Hz mono Ogg Opus, which execs does not
  decode; it checks the refusal message.
  `ffmpeg -f lavfi -i "sine=frequency=660:duration=0.3" -ac 1 -c:a libopus -b:a 24k -map_metadata -1 tone-660hz-opus.ogg`
