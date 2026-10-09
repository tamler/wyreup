# Private ChatGPT pilot

This is a private integration candidate. Local checks alone do not establish that ChatGPT accepts the tools, renders the card, or saves files. Record actual host tests before calling it a working pilot; three outside-user trials gate public submission.

## Build the reviewed runtime

From the repository root, with Node 24.18.1, pnpm 10.34.5 and Docker:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @wyreup/chatgpt-pilot typecheck
pnpm --filter @wyreup/chatgpt-pilot lint
pnpm --filter @wyreup/chatgpt-pilot test
pnpm --filter @wyreup/chatgpt-pilot build
docker build -f packages/chatgpt-pilot/Dockerfile -t wyreup-chatgpt-pilot:candidate .
docker image inspect wyreup-chatgpt-pilot:candidate --format '{{.Id}}'
```

Record the immutable image ID and the source commit, bundle hashes, dependency audit and independent review. Set `WYREUP_CHATGPT_IMAGE` to that exact `sha256:` ID, not the mutable tag. The launcher uses a non-root, read-only container with no host mounts or public ports, all capabilities dropped, no-new-privileges, two CPUs, 64 PIDs and a 1 GiB hard memory limit without swap. It passes only `WYREUP_CHATGPT_DOWNLOAD_HOSTS` into the container; the tunnel runtime key stays on the host. Docker must remain available while the pilot is running. No container log driver is enabled.

## Connect privately

Use the attested official OpenAI tunnel client. Create a tunnel linked to the intended ChatGPT workspace and use a runtime-only key with Tunnels Read and Use, stored outside the checkout with mode 600. Do not paste credentials into chat or terminal command arguments. Use the client's `env:` or `file:` secret reference. Never give the adapter an administrative key.

The MCP command is the absolute Node executable plus the absolute path to `packages/chatgpt-pilot/scripts/run-container.mjs`. Supply the reviewed image ID and exact host allowlist through the managed runtime environment. Run the client's `runtimes connect --help` for its current profile/environment options; use `runtimes connect` for managed operation, not a detached ad hoc process. Keep any health listener on loopback and raw/trace logging disabled. Verify `runtimes status` reports the actual process running, healthy and ready before installing the private plugin.

In ChatGPT, Add custom MCP server, select the tunnel connection, enter the tunnel ID, and use no additional server authentication: the tunnel already controls access. This is a private connection, not a public directory submission. Record the workspace association and connection status without credential values.

The download allowlist initially defaults to empty. First send a non-sensitive synthetic upload. Its expected `FILE_HOST_NOT_ENABLED` error reports only the bounded upload hostname. Confirm that it is an OpenAI-provided file origin, then configure that exact lowercase hostname in `WYREUP_CHATGPT_DOWNLOAD_HOSTS` and restart the managed runtime. No wildcard, suffix, IP literal or redirect allowance is supported. New hosts require the same explicit observation. Test fixtures can separately allow `raw.githubusercontent.com`; that does not prove a ChatGPT upload works.

## Three workflows

- Compress one JPEG, PNG or WebP to an integer target from 10 to 10240 KB; default 200 KB. Downscaling is allowed by default. A target the processor cannot reach returns an error without output bytes or a download.
- Remove metadata from one JPEG, PNG or WebP. Orientation is baked into the pixels, and JPEG/WebP are re-encoded at quality 95. This does not redact visible content.
- Merge two to five PDFs in their supplied order, up to 100 combined pages. Merging preserves document contents; it does not sanitize active content.

Compression can convert an over-target PNG to JPEG and lose transparency. Only accepted JPEG/PNG/WebP signatures are processed; declared filenames and MIME types do not authorize a format. Images must be single-frame, have positive safe-integer dimensions, fit 16 megapixels, and pass full codec decoding with matching header dimensions. Encrypted or malformed PDFs are rejected.

Uploads and output bytes pass through OpenAI. Processing runs on the operator's host. Wyreup writes and retains no server-side job files. The mounted ChatGPT card retains the result until cancellation or teardown, and OpenAI's retention policies apply. The whole workflow is not a no-upload/local-only flow.

## Limits and download proof

One job runs at a time. The adapter enforces 8 MiB per input, 24 MiB total input, a 20-second download deadline, a 60-second disposable-worker deadline, 7 MiB output and a 10 MiB result/widget request envelope. Incoming MCP JSON is limited to 64 KiB. The output ceiling was lowered after an actual standard SDK stdio test rejected an 8 MiB result because its base64 response exceeded the default 10 MiB buffer. The corrected implementation passed the actual default transport at 7 MiB with exact bytes and no parser errors; an injected 8 MiB result returned a small `OUTPUT_TOO_LARGE` error. The result-size check excludes JSON-RPC framing, while the measured wire response at the raw ceiling is below the default buffer. Actual ChatGPT transport limits still need measurement. Native/WASM memory is bounded by the container rather than the worker's JavaScript heap. Container exhaustion may disconnect the call; restart the managed runtime and verify a fresh valid request succeeds before continuing.

The card verifies output length and SHA-256, then offers an explicit Download file button. It uses only the host's standard `ui/download-file` capability with inline bytes. If unsupported, it explains that limitation without an alternate upload or navigation path. A host acknowledgment means only that ChatGPT accepted the request; inspect the saved file on disk for completion. Denied, cancelled or timed-out requests require explicit user retry. No automatic retries or duplicate pending requests occur.

Record all three actual ChatGPT workflows with input/output hashes, valid output signatures, target size or truthful failure, orientation and absent metadata, and ordered PDF page markers. Also test invalid input, cancellation, unsupported download capability where reproducible, and a near-ceiling output. Keep signed URLs, IDs, filenames supplied by users, credentials and raw file bodies out of logs/evidence. Synthetic fixtures and fixed output names are safe to record.

Use [the outside-user protocol](CHATGPT-PILOT-USER-TEST.md) after technical acceptance. Leave unexecuted cases explicitly unrun. Do not submit publicly before the independent final review and those trials pass.
