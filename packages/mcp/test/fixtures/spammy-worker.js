// Emits 20 MB of stderr to verify the supervisor's ring buffer caps at 8 KB.
// Exits after emitting a stub success message.
const buf = Buffer.alloc(1024, 'x');
for (let i = 0; i < 20_000; i++) process.stderr.write(buf);
if (process.send) {
  process.send({ ok: true, writtenPaths: [] });
}
process.exit(0);
