# Tool-quality review (phase 1) — 2026-07-11

Swarm review of all 261 tools: 23 category batches reviewed by bulk-tier
workers against seven checks (C1 output-worse-than-input, C2 privacy
truthfulness, C3 human-readable output, C4 chain sanity, C5 naming,
C6 description accuracy, C7 param sanity), high-severity claims
adversarially verified per finding and adjudicated against source by the
session lead. Raw data: 279 findings, 258 chain-suggestion entries
(scratchpad `phase1/merged-*.json`, copied to `docs/data/`).

## Verified headline results

- **No ship-blocking defects found.** All 10 worker-reported "high"
  findings were refuted, downgraded, or turned out to be intentional on
  verification (details below). The catalog's core behavior is sound.
- **Param exposure resolved (wave-2 audit, 2026-07-11): no functional
  gaps.** 43 tools have params in `defaults` absent from `paramSchema`,
  but every rendering path derives from `defaults`: the MCP server builds
  agent schemas from it, and the web `ParamsForm` iterates `defaults`
  directly (verified live: crop renders x/y/width/height as editable
  inputs). `paramSchema` only upgrades widgets — labels, help text,
  sliders, enums. The 43-tool list is therefore a widget-polish backlog,
  not a bug list.
- **2 dead-end tools** whose output no catalog tool accepts:
  `split-sheets`, `chat-long-pdf-pro`.
- **242 tools now have curated chain suggestions** proposed
  (semantic next-steps, not MIME-legal noise) — ready to land as
  `chainSuggestions` metadata; see the JSON payload.

## High-claim adjudication (why zero highs survived)

| claim | verdict |
|---|---|
| percentage-calculator unusable (only `mode` exposed) | custom `PercentageCalculatorRunner` provides the inputs — web OK; MCP sees all params |
| zip-extract / zip-create params invisible | custom runners (`MultiOutputRunner`/`MultiInputRunner`); verify runner coverage (P2 item) |
| zip-remove destructive `**/.env` default | pattern is editable and visible in UI — downgraded to medium copy issue |
| image-similarity / signed-cookie-decode privacy | worker self-refuted ("PASS" emitted as finding) — noise |
| image-diff can output larger file | a diff image is not a size promise — mis-applied check |
| compress inflates on explicit targetFormat conversion | intentional (explicit format conversion); param not exposed on web |
| pdf-encrypt "optional" wording | grammar ambiguity ("optional" modifies permissions) — low |
| pdf-compress deletes DecodeParms | applies to re-encoded streams; worth an eng glance — medium-low |

## Medium findings (77) — triage queue

### C6 — Description accuracy (24)

- **zip-create** — Return type is Blob[] (array) which is inconsistent with the single-archive promise. If the runner expects Blob[], this is harmless; if it expects a single Blob, this could break. The inconsistency should be resolved.
  - fix: Change return type to Promise<Blob> to match the single-archive output contract, or explicitly set output.multiple = false to clarify intent.
- **zip-info** — Compressed size reporting depends on a private JSZip API that may break on dependency upgrades, silently returning wrong data.
  - fix: Add a try/catch around internal data access, or compute compressed size reliably via the library's public API (e.g. check JSZip's available public methods for size reporting).
- **audio-enhance** — description-accuracy
  - fix: Clarify that the tool always processes input, even if already high-quality, and may degrade it.
- **roman-numeral** — Tool accepts */* input (min:0) but completely ignores uploaded files. The code uses only the `input` param and never reads file content (`async run(_inputs: File[], params: RomanNumeralParams, ctx: ToolRunContext)` — `_inputs` is prefixed underscore and unused). A user who uploads a file containing numbers will get no processing of that file, which the description does not disclose.
  - fix: Either remove file input acceptance (change min to 0 and accept to [] or comment) or process the file content when provided.
- **url-build** — Description claims round-trip with url-parse by passing JSON output, but tool ignores input files; user must paste JSON into spec param manually.
  - fix: Either process input file(s) as the spec, or update description to clarify that the JSON must be entered in the spec param, not piped through file input.
- **csv-json** — Description omits that JSON input must be an array. Converting a JSON object to CSV fails silently (throws error).
  - fix: Update description to mention 'JSON input must be an array of objects' or add support for object-to-CSV (single row with keys as header).
- **pdf-metadata** — The tool's output MIME in the module declaration is `application/pdf` but when mode is 'read' the actual returned content type is `application/json`. The metadata claim is inaccurate.
  - fix: Change the output mime to allow either `application/pdf` or `application/json`, or document the dual output in the description.
- **csv-merge** — Description says 'Join two CSVs on a key column' but does not mention that the right file's key column is always dropped from the output. Also does not mention that for headerless CSVs, the key must be a 0-based index. This is hidden behavior that affects the result shape.
  - fix: Update description to note that the right-side key column is excluded from the output (since it duplicates the left-side key by definition).
- **color-blind-simulator** — The declared output mime in the metadata is 'image/png' but the code actually supports PNG, JPEG, and WebP based on the 'format' parameter. The code will create a blob with the correct MIME for the chosen format, but the tool metadata declares output.mime as 'image/png' — this mismatch means the runner may display or handle the output incorrectly when JPEG or WebP is selected.
  - fix: Update output.mime to 'image/*' to reflect the actual supported output formats.
- **pdf-to-text** — Metadata states 'params: none', but the source code defines a `separator` parameter (type `string`) that is used in the `run` function and has a default value.
  - fix: Either update metadata to declare the `separator` parameter, or remove it from code if unintended.
- **pdf-extract-tables** — Metadata says 'params: none', but the code declares three parameters: `format` (json/csv), `page` (number), and `rowTolerance` (number). Also, the declared output MIME is 'application/json', but when `format='csv'` the tool outputs `text/csv`, which is inconsistent.
  - fix: Update metadata to list all params and declare output MIME as either dynamic or specifically 'application/json' with a note that CSV output overrides the MIME type.
- **color-palette** — The description says 'Extract dominant colors from an image as hex codes.' The code only processes pixels with alpha >= 128 (semi-opaque threshold) and skips transparent ones, but does not mention this behavior. Also, the median-cut algorithm samples down to at most 10,000 pixels (`const stride = Math.max(1, Math.floor(data.length / (4 * 10_000)));`) which means for very large images, it may miss subtle dominant colors.
  - fix: Document that semi-transparent pixels (alpha < 128) are ignored and that large images are downsampled to 10k pixels before analysis.
- **image-diff** — The description says 'Pixel-level diff between two images of the same dimensions.' However, the code also outputs an additional JSON blob containing diff statistics (pixelsDifferent, totalPixels, percentDifferent) alongside the diff image. The description does not mention that a JSON stats output is produced.
  - fix: Either mention the JSON stats output in the description, or remove the extra blob if not intended.
- **word-counter** — The description says 'Count words, characters, sentences, paragraphs, and estimate reading time.' For HTML inputs, it strips HTML tags (`stripHtmlTags`) and then counts. However, for markdown inputs (text/markdown), the code does NOT strip markdown syntax — it passes the raw markdown text to the counter. This means words like '**bold**' would be counted as including the asterisks. The description does not mention this limitation.
  - fix: Add markdown stripping or document that markdown syntax is not stripped before counting.
- **extract-audio** — toolId: extract-audio
  - fix: Parameters format and bitrate exist in code but are hidden from metadata.
- **trim-media** — toolId: trim-media
  - fix: Parameters start, end, stream_copy exist in code but are hidden from metadata.
- **video-to-gif** — toolId: video-to-gif
  - fix: Parameters fps, width, startSeconds, durationSeconds exist in code but are hidden from metadata.
- **convert-subtitles** — toolId: convert-subtitles
  - fix: Parameters to and timeShiftSeconds exist in code but are hidden from metadata.
- **burn-subtitles** — toolId: burn-subtitles
  - fix: Parameters fontSize and crf exist in code but are hidden from metadata.
- **strip-video-metadata** — Description claims 'Remove all metadata' but code only removes global container metadata, not per-stream metadata.
  - fix: Either add '-map_metadata:s', '-1' for each stream type to truly remove all metadata, or update the description to 'Remove container-level metadata'.
- **pdf-flatten** — Flatten PDF Form description does not disclose that when the PDF has no interactive form fields, the output is the exact same input bytes. Users expecting a flattening operation may think something changed when nothing did. The only signal is a progress message ('No interactive fields — passing through'), which is non-obvious.
  - fix: Document that if the PDF has no form fields, the output is identical to input, or add a visible warning in the result.
- **pgp-encrypt** — Output mime metadata declares 'text/plain' but the code returns 'application/pgp-encrypted' when the armor parameter is false.
  - fix: Update output mime declaration to reflect both possible types, e.g., use 'text/plain, application/pgp-encrypted' or change metadata to 'application/octet-stream' and adjust param defaults.
- **bg-remove** — Output mime metadata declares 'image/png' but the code can output 'image/webp' when the outputFormat parameter is set to 'webp'.
  - fix: Update output mime declaration to include 'image/webp' or document that only PNG is the declared output while webp is an internal override.
- **text-sentiment-pro** — Description promises a ternary classification (positive / negative / neutral) but the code does not validate the model response against those three values.
  - fix: Validate the returned sentiment is one of the promised values, or soften the description.

### C3 — Human-readable output (17)

- **roman-numeral** — Human-facing JSON output is nested (array of objects, array of strings) and would display as raw code in the runner rather than a readable table.
  - fix: Consider flattening or presenting results as a one-level-per-entry if the runner doesn't handle nested JSON readably.
- **json-unflatten** — Human-facing JSON output is nested (reconstructed object) and would display as raw code in the runner rather than a readable table.
  - fix: If this tool is intended for human reading, consider a flatter output format; otherwise, note that the runner will show raw JSON.
- **jwt-decoder** — Nested JSON: header and payload are Record<string, unknown>, making the output contain nested objects that a flat renderer would show as raw code. This is human-facing information.
  - fix: Pre-render header and payload as flat key-value lists, or document that the runner's flat renderer handles this suboptimally. Alternatively, un-nest key claims (iss, sub, exp) to the top level and keep nested original under e.g. "headerRaw" / "payloadRaw".
- **cron-parser** — Nested JSON: `fields` contains arrays, making the output go beyond one flat level. Human users reading nextRuns and fields info would see raw JSON for the nested part.
  - fix: Flatten field values into top-level keys (e.g. "fields.minute", "fields.hour") or pre-render field value summary as a string. Alternatively, move `nextRuns` display to a string field and document that the runner shows nested JSON raw.
- **sql-format-explain** — Nested JSON: `annotations` is an array of objects (each with clause/text/explanation), making the output contain nested structures. A flat renderer would show raw JSON for the annotations part.
  - fix: Pre-render annotations as a single formatted string (e.g. multiple lines) or flatten to top-level fields. The formatted SQL and summary alone are flat; annotations are the nesting offender.
- **json-merge** — Nested JSON: `merged` can be deeply nested, `conflicts` is an array of objects. Human reading the merge report would see raw nested JSON.
  - fix: Pre-render the conflicts as a formatted textual diff and the merged result perhaps as a separate output file. Document nested JSON limitation or split into multiple output Blobs.
- **image-similarity** — Output MIME is application/json. The result contains: images (array of {filename, index}), pairwise (array of {a, b, cosine}), and clusters (array of arrays). This is deeply nested JSON: pairwise has objects with numeric fields, clusters is an array of arrays of numbers. While the flat fields (images) are readable, pairwise and clusters are arrays-of-objects/arrays that the runner would show as raw code. Per C3, flag human-facing JSON that shows raw code.
  - fix: Consider rendering pairwise as a table or flattening the output for readability.
- **excel-info** — Output MIME is application/json. The result has perSheet as an array of objects with preview (2D array of unknown values). Deeply nested: perSheet is an array of { name, rows, cols, preview: unknown[][] }. The preview field is a nested array that would show raw code. This is user-facing info meant to be read by humans.
  - fix: Consider flattening the preview or rendering it as a table.
- **unicode-info** — Output MIME is application/json. The result contains chars as an array of objects (UnicodeCharInfo with 9 fields each). This is a large nested array of objects. The runner would show raw JSON for these arrays. While a summary (length, codepoints, bytes, etc.) is flat, the chars array is deeply nested and human-unfriendly in raw JSON.
  - fix: Consider paginating or truncating the chars array, or rendering it as a table in the runner.
- **css-minify** — The output includes `application/json` (the stats object with `bytesIn`, `bytesOut`, `reductionPercent`, `warnings`, `errors`). This JSON is human-readable stats — it is nested (has arrays `warnings`, `errors`) and will be rendered as raw JSON code for the user, which is confusing.
  - fix: Either remove the stats JSON output entirely since minification results speak for themselves, or flatten the stats into a simple key-value structure the runner renders well (e.g. split warnings/errors into a different output format).
- **html-minify** — The output includes `application/json` (stats with `bytesIn`, `bytesOut`, `reductionPercent`). This is a flat object (no nested arrays/objects), so the runner will render it readably. No findings.
  - fix: 
- **pdf-form-fields** — PDF Form Fields outputs JSON with nested objects/arrays (fields array) that is not human-readable via the runner's flat rendering. Users see raw JSON.
  - fix: Either flatten the output to a one-level object, or rely on the runner's JSON display (already shows pretty-printed JSON). This may be intentional for further processing. Flag for review: if human-facing, flatten; if machine-only, this is fine.
- **prompt-injection-demo** — Output is application/json with nested structures (highlights array of objects) intended for human reading. The default flat renderer would show raw JSON, which is not readable for a human-facing display.
  - fix: Consider flattening the key human-readable fields (e.g., summary, totals) into a top-level flat object and moving nested highlights to a separate field that the runner can optionally expand, or mark the tool as interactive to use its own render.
- **content-safety-pro** — Output is application/json with a nested array property (categories) that would show raw JSON in the default flat renderer, reducing readability.
  - fix: Flatten categories into a comma-separated string or use an object with boolean keys so the runner can render it readably.
- **html-extract-links** — Output MIME is application/json and the result structure contains nested objects: 'byKind' is a partial record, 'hostnames' is a flat record (ok), but 'links' is an array of ExtractedLink objects (each an object with nested fields like resolved, hostname). The runner renders flat one-level objects readably — the nested links array would show raw JSON.
  - fix: Provide a flat summary count by kind at the top level so the primary readout is flat; the full links array could be collapsed or paginated.
- **text-stats-by-paragraph** — Output MIME is application/json and the result structure contains nested objects: 'paragraphs' is an array of ParagraphStats objects, and each ParagraphStats object may contain 'readability' (a nested object with flesch/fleschKincaid/gunningFog). The runner only renders flat one-level objects readably — these nested structures would show raw JSON.
  - fix: Flatten readability fields to the paragraph level (flesch, fleschKincaid, gunningFog as top-level optional fields) so the runner's flat display works.
- **deep-analysis-pro** — Output MIME is application/json and the result structure contains nested objects: 'result' has { answer: string; reasoning: string }. Although these are flat at one level, the user sees these two text fields as JSON key-value pairs. The runner renders flat one-level objects readably — so nested isn't the issue, but the runner's flat display would show 'answer' and 'reasoning' as key-value text pairs, which is readable. However, if the 'reasoning' field is a long step-by-step text, rendering it in a flat JSON view is not ideal for a human reading experience. The 'answer' and 'reasoning' are both strings, so the flat display works, but a prose-oriented display might be better.
  - fix: Consider a custom output display for this tool rather than raw JSON, but the runner's flat rendering works.

### C7 — Param sanity (17)

- **favicon** — Missing paramSchema for sizes and includeIco params; users cannot customize these.
  - fix: Add paramSchema entries for sizes (array of numbers) and includeIco (boolean) so users can control output.
- **csv-merge** — Default delimiter is blank string, which triggers auto-detect from the left file via parseOptions. However, the right file is always parsed with delimiterOverride ?? leftParsed.meta.delimiter — so if the right file uses a different delimiter than the left, it will silently misparse. A surprise to users who assume each file is parsed independently.
  - fix: Either auto-detect per file, or document that both files must share the delimiter of the left file.
- **csv-sort** — When numeric comparison is off (default), values are compared with localeCompare. This sorts '10' before '2' in string order. A user who forgets to enable numeric sort gets wrong ordering with no warning. The description says 'as text or numbers' but the default is text sort which surprises many.
  - fix: Consider auto-detecting numeric columns (parseFloat non-NaN on all rows) or default to numeric for columns containing numbers.
- **hash** — The default algorithms are ['SHA-256'] but the paramSchema defines algorithms as 'multi-enum' with options SHA-1, SHA-256, SHA-512 — the defaults match. However, the description promises 'SHA-256, SHA-1, or SHA-512' but computes only the algorithms the user selects. No surprise here. But there is a missing param: the tool computes hashes for multiple input files (batchable: true), yet the result object for single input ({name, bytes, hashes}) differs structurally from multiple-input (array of same). The description does not mention this structural output difference, which could confuse consumers of the JSON.
  - fix: Document output shape or always return an array.
- **image-similarity** — The param `threshold` has a default of 0.85 with a range 0-1 in the type. However, the description says 'threshold for clustering (0-1)' but in the clustering function `clusterByThreshold`, images are unioned when `cosine >= threshold`. A threshold of 0 means EVERY image is in one cluster (since cosine is always >= 0), which is a valid edge case but may surprise users who expect 0 to mean 'no matching.'
  - fix: No change needed; behavior is consistent with cosine similarity semantics.
- **yaml-validate** — The `rejectDuplicateKeys` param defaults to `true` and the code at line `json: !(params.rejectDuplicateKeys ?? true)` inverts the meaning — when `rejectDuplicateKeys` is true, `json` is set to `false`, which means js-yaml's duplicate-key rejection is explicitly DISABLED. The param name suggests the opposite of what it does.
  - fix: Remove the negation: `json: params.rejectDuplicateKeys ?? true` so the param name matches behavior, or rename the param to `allowDuplicateKeys`.
- **signed-cookie-decode** — The `secret` param has paramSchema `{ type: 'string', label: 'secret', help: 'The framework's signing key. Never uploaded.', placeholder: 'cookie-signing-secret', multiline: true }` but the tool's input `accept: ['*/*']` with `min: 0` means no input file is required — all data comes via params. A user could mistakenly paste a single-line key into a multiline field (no actual issue), but more importantly, the `style: 'auto'` default can silently guess wrong: if a Rails-style cookie `base64--hex` contains no `--`, or an Express cookie happens to contain `--`, the auto-detection misclassifies. The auto-detect logic also splits on `.` for Flask, but Express cookies with a `.` in the value (e.g. from a JSON payload) would be misidentified as Flask.
  - fix: Document the auto-detection ambiguity or add a heuristic check on value format before classifying.
- **trim-media** — toolId: trim-media
  - fix: Add paramSchema; consider changing default end to null/undefined or auto-detecting video duration.
- **resize-video** — toolId: resize-video
  - fix: Remove default width/height so the video stays at original resolution when both are blank, or auto-detect original dimensions.
- **crop-video** — Default crop dimensions (640x480 at x=0,y=0) may exceed input resolution, leading to an unhandled ffmpeg error. No validation checks crop bounds against input dimensions.
  - fix: Add resolution probing (like duration is probed) and clamp crop region to input dimensions, or validate and surface a clear error message.
- **fade-video** — Fade-out duration longer than the clip is silently dropped — no fade-out is applied and no warning or error is given to the user.
  - fix: Validate that fadeOut < durationSec (or fadeIn + fadeOut <= durationSec) and surface an error to the user, or cap the fade duration to the clip length.
- **pdf-compress** — Default `pngToJpeg: true` converts PNG images to JPEG even if the PNG has transparency or is better as PNG. The code attempts to check for DeviceRGB colorspace, but due to a bug it always treats `isPng && (pngToJpeg || true)` as true (the `|| true` short-circuits the check), and only skips if the colorspace string includes 'DeviceRGB' — but PNGs with alpha that have DeviceRGB colorspace will still be converted, losing transparency data.
  - fix: Fix the bug: remove `|| true`. Also check for transparency/alpha channel before converting PNG to JPEG.
- **watermark-pdf** — Watermark PDF color parameter accepts any string but only hex colors with '#' work correctly. Named colors, hex without '#', or rgb() strings cause silent NaN crash during rendering. The paramSchema says 'CSS hex color' but there is no client-side validation before run.
  - fix: Add param validation that color starts with '#' and is valid hex, or use a proper color-picker/enum.
- **pdf-extract-data** — PDF Extract Data's currency parameter with an empty string causes an infinite loop in moneyPattern because escapeRegExp('') returns '' and the regex matches everywhere. No validation prevents empty currency.
  - fix: Reject empty currency parameter or default to '$' when empty.
- **text-sentences** — Param name 'oneLine' is counterintuitive: when true, it produces multiple lines (one per sentence).
  - fix: Rename to 'multiLine' or 'linePerSentence' to match actual behavior.
- **text-dates** — The normalize feature silently skips relative dates like 'next Tuesday' without warning, which may surprise users expecting a unified ISO result.
  - fix: Document the limitation or add a fallback/estimate for relative dates.
- **extract-article-text** — With format='html', the output MIME is set to 'text/html' but the declared output mime is 'text/plain' — mismatch could break chain validation.
  - fix: Either declare both output types or coerce HTML output to plain text.

### C1 — Output worse than input (10)

- **zip-remove** — Both tools can silently return a larger ZIP than the input by always re-compressing (DEFLATE level 6) regardless of entry type or original compression method.
  - fix: Detect when no entries are removed/modified (output equals input except for re-compression) and either return the original bytes or offer a STORE option for already-compressed content.
- **zip-flatten** — zip-flatten can silently produce a larger archive by always re-compressing with DEFLATE level 6.
  - fix: Same as zip-remove: detect no-op (all entries already at root) and return original bytes, or allow STORE compression.
- **audio-enhance** — output-worse-than-input
  - fix: Check input sample rate and skip enhancement if already >= 48 kHz, or warn the user.
- **flip-image** — A flip of a lossless PNG re-encodes at JPEG-quality 90, potentially producing a larger/worse file. The tool silently returns a worse file.
  - fix: Use lossless encode options for PNG input, or at minimum compare output size and warn/fall back.
- **grayscale** — Grayscale of a lossless PNG re-encodes with lossy quality setting. A lossy re-encode can produce a larger/worse file.
  - fix: Use lossless encode for PNG source, or compare output size and handle the case.
- **sepia** — Sepia of a lossless PNG re-encodes with lossy quality. The tool can silently return a larger/worse file.
  - fix: Use lossless encode for PNG source, or compare output size and handle the case.
- **invert** — Invert of a lossless PNG re-encodes with lossy quality. The tool can silently return a larger/worse file.
  - fix: Use lossless encode for PNG source, or compare output size and handle the case.
- **crop** — Crop of a lossless PNG re-encodes with lossy quality. The tool can silently return a larger/worse file.
  - fix: Use lossless encode for PNG source, or compare output size and handle the case.
- **color-blind-simulator** — The tool promises a 'simulation' transform but can produce an output file larger than the input when png is selected and the input is a small JPEG — the transformed image will be PNG (lossless, often much larger) regardless of original size. The code does not check whether the result is bigger or warn the user.
  - fix: Either update output.mime to match the format param, or add a warning when output size exceeds input.
- **compress-video** — toolId: compress-video
  - fix: Check output size against input size and warn or fall back if the result is not smaller.

### C5 — Naming (7)

- **sql-formatter** — Potentially confusable with "sql-format-explain" (name: "SQL Format + Explain"). A user looking for SQL formatting might pick either.
  - fix: Rename "sql-formatter" to "SQL Format (Plain)" or ensure the description clearly says "format only, no explanation" to disambiguate from sql-format-explain.
- **ocr** — Naming conflict: both this tool and 'ocr-hq' are named 'OCR' in the catalog, which will confuse users.
  - fix: Rename this free tool to 'OCR (Tesseract)' or 'OCR (Free)', and the credit tool to 'OCR (HQ)' or 'OCR (Pro)'.
- **transcribe** — Naming conflict: both this tool and 'transcribe-pro' are named 'Transcribe Audio' in the catalog.
  - fix: Rename one: 'Transcribe Audio (Free)' for this tool, 'Transcribe Audio (Pro)' for the credit version.
- **transcribe-pro** — Naming conflict with 'transcribe' (free) — both named 'Transcribe Audio'.
  - fix: Rename to 'Transcribe Audio (Pro)' or similar.
- **ocr-hq** — Naming conflict with 'ocr' (free) — both named 'OCR'.
  - fix: Rename to 'OCR (HQ)' or 'OCR (Pro)'.
- **image-describe** — Naming conflict with 'image-caption' (free) — both named 'Describe Image'.
  - fix: Rename the free tool to 'Describe Image (Free)' or this credit tool to 'Describe Image (Pro)'.
- **image-caption** — Naming conflict with 'image-describe' (credit) — both named 'Describe Image'.
  - fix: Disambiguate by renaming the free tool to 'Caption Image' or 'Describe Image (Free)', and the credit tool to 'Describe Image (Pro)'.

### C2 — Privacy truthfulness (1)

- **upscale-2x** — The code imports `getPipeline` from `../../lib/transformers.js` which loads a model from Hugging Face via `Xenova/swin2SR-classical-sr-x2-64`. The model download goes to `models.wyreup.com` (static assets) which is acceptable for a 'free' tool. However, the `blobToDataUrl` function converts the file contents to a base64 data URL inline, which is local processing — no network transmission of user data. PRIVACY TRUTHFULNESS: OK.
  - fix: 

### C4 — Chain sanity (1)

- **text-to-speech-pro** — chain-sanity
  - fix: Replace with tools that accept audio/mpeg: transcribe, audio-enhance, convert-audio, trim-media, normalize-loudness.

## Low findings (192) — polish backlog

Kept in `docs/data/tool-review-findings-2026-07-11.json`; not inlined here.

## Recommended next wave

1. Land the curated `chainSuggestions` (242 tools) — one mechanical PR,
   directly serves the chaining goal and fixes the MIME-noise suggestions.
2. Sweep the 43 custom runners once for param coverage vs `defaults`.
3. Triage the C6 description-accuracy mediums (24) — copy edits, cheap.
4. Give `split-sheets` and `chat-long-pdf-pro` a consumer or an explicit
   terminal-output treatment.
5. C3 nested-JSON tools (17): extend FlatJsonResult with a one-level
   nested rendering, or curate per-tool formatters.
