# Wyreup search growth plan

Updated 2026-10-08. Owner: the site operator. This is a manual operating plan; it does not enable tracking, scheduled jobs, outreach or a production release.

## Goal and boundaries

Help people find the specific file task they need, then complete it with accurate expectations about supported files, privacy and output. Improve existing useful pages before adding more keyword routes. Search Console measures Google search visibility without adding a visitor analytics script. It does not measure successful tool runs or all traffic sources.

The first five clusters below are product-fit priorities, not proven high-volume or low-competition opportunities. Demand, competition and conversion remain unknown. Search Console currently provides only small samples, so treat impressions as leads to investigate rather than proof of a market. Do not promise rankings, guaranteed compression ratios, anonymity or universal offline execution.

## Observed Search Console baseline

Read from the verified `sc-domain:wyreup.com` property on 2026-10-08:

| Report | Observation |
| --- | --- |
| Performance | Three-month filter; chart July 14–October 5, 2026. 16 clicks, 325 impressions, 4.9% CTR, average position 18. |
| Visible queries | `site:wyreup.com`: 43 impressions; `otpauth`: 5; `reevown`: 3; `open pgp file`, `crossfade video`, `rewrapper`, `html redactors`: 1 each. All seven displayed rows had zero clicks. Query reporting excludes anonymized queries; these rows do not explain all 16 clicks. |
| Landing-page clicks | Home: 11 clicks/49 impressions. `pgp-armor`: 1/11; `image-similarity`: 1/3; `pdf-form-fields`: 1/3; `burn-subtitles`: 1/1; `split-sheets`: 1/1. |
| Pages to investigate | Tools catalog: 0 clicks/107 impressions; face blur: 0/66; legal terms: 0/64; image convert: 0/64. Page and property totals aggregate differently, so do not sum page impressions into the property total. |
| Indexing | Updated October 4: 218 indexed, 397 not indexed. Exclusions: 238 redirects, 11 proper canonical alternatives, 5 not found, 1 soft 404, 109 crawled not indexed, 33 discovered not indexed. |
| Sitemap | Success; last read October 2; 294 discovered URLs. Live sitemap omitted categories and public distribution/legal/pricing pages and used slashless URLs while HTML canonicals used trailing slashes. |
| URL inspection | Face-blur inspection returned Google's “Something went wrong.” Its current inspection result was not established. No new sitemap submission or validation request was performed. |

Normal redirects and canonical alternatives are expected exclusions. Do not try to force every URL into the index. Investigate important useful pages within the crawled/discovered exclusions individually. An indexing diagnosis is not evidence of a ranking penalty.

The 404 sample included `/legal/pricing/`, `/privacy.html`, two `/tools-mock/` paths and `/cdn-cgi/l/email-protection`. Public checks on October 8 confirmed the pricing and legacy privacy paths still returned 404. The local fix adds exact permanent redirects to `/pro/` and `/legal/privacy/`; bogus mock and Cloudflare paths remain real 404s. The single soft 404 was `/chain/run/`, last crawled July 24; the local workspace indexing policy now excludes that application route with `noindex,follow`. Its live status will need checking after release. Full crawl-exclusion samples still need individual investigation. No blanket redirects.

## Query-to-page map

Each cluster has one primary landing page. Supporting pages have a different useful role and link to the primary page. Keep the task pages and configurable tool pages independently useful and indexable; do not create aliases for slight keyword variations.

| Priority | Query cluster and candidate searches | Primary landing page | Supporting page role | Evidence / next decision |
| --- | --- | --- | --- | --- |
| First | Remove photo GPS / location / EXIF data | [/remove-photo-location-data/](https://wyreup.com/remove-photo-location-data/) | `/tools/strip-exif/` explains EXIF cleanup, formats and re-encoding; `/share-photo-safely/` combines cleanup and compression. | Strong privacy task fit. Search demand unknown; inspect indexing and task queries. |
| First | Blur faces online / blur faces without uploading | [/tools/face-blur/](https://wyreup.com/tools/face-blur/) | `/tools/pixelate-region/` handles selected regions; metadata-removal task covers hidden fields. | 66 page impressions, zero clicks in observed report. Inspect queries, position, country and device before interpreting CTR. |
| First | Convert iPhone HEIC to JPG / HEIC upload rejected | [/convert-heic-to-jpg/](https://wyreup.com/convert-heic-to-jpg/) | `/tools/heic-to-jpg/` covers selectable PNG/WebP output, quality and batches. | Compatibility task fits current capability. Demand and competitiveness unknown. |
| First | Compress photo for email / photo too large to attach | [/compress-photo-for-email/](https://wyreup.com/compress-photo-for-email/) | `/tools/compress/` provides quality settings; `/tools/resize/` reduces dimensions. | Useful concrete situation; size savings must be checked per file. Demand unknown. |
| First | Convert JPG PNG WebP / image format converter | [/tools/convert/](https://wyreup.com/tools/convert/) | HEIC task routes a different input; `/tools/svg-to-png/` handles SVG. | 64 page impressions, zero clicks. Review actual queries before expanding conversion pages. |
| Next | Image to text / OCR screenshot or scan | [/tools/ocr/](https://wyreup.com/tools/ocr/) | `/scan-to-searchable-text/` explains a scanned-page task. | Inputs are images, output plain text; not a searchable PDF. Demand unknown. |
| Next | Compress PDF for upload / reduce PDF size | [/compress-pdf-for-upload/](https://wyreup.com/compress-pdf-for-upload/) | `/tools/pdf-compress/` exposes image-quality settings and explains limited embedded-image recompression. | No lossless or target-size promise. Inspect impressions and PDF-type queries. |
| Next | Open PGP file / decrypt PGP online | [/tools/pgp-decrypt/](https://wyreup.com/tools/pgp-decrypt/) | `/tools/pgp-armor/` distinguishes decoding an envelope from decrypting; encryption/signature pages cover separate tasks. | `open pgp file`: one query impression; too small to infer demand. Requires a private key. |
| Next | PGP ASCII armor / armor decoder | [/tools/pgp-armor/](https://wyreup.com/tools/pgp-armor/) | Decrypt tool explains encrypted payloads. | One click/11 page impressions. Inspect which queries produced that visibility. Armor is not encryption. |
| Next | List PDF form fields / AcroForm field names | [/tools/pdf-form-fields/](https://wyreup.com/tools/pdf-form-fields/) | PDF category offers filling/flattening tools for different goals. | One click/3 page impressions. JSON inspection output, not form editing. |
| Measure cautiously | Image similarity / compare photos | [/tools/image-similarity/](https://wyreup.com/tools/image-similarity/) | `/tools/image-diff/` compares pixels; `/tools/hash/` checks file bytes. | One click/3 page impressions. Runtime now uses decoded images and CLIP image embeddings. Duplicate/distinct fixture checks pass in Node and Chrome; broader accuracy is unmeasured. Scores suggest manual review, not automatic duplicate or deletion decisions. |
| Next | otpauth URI generator / TOTP QR code | [/tools/otpauth-uri/](https://wyreup.com/tools/otpauth-uri/) | TOTP/HOTP tools perform a different operation from enrollment. | `otpauth`: five query impressions. Keep secrets and QR codes private. |
| Developer | MCP image PDF file tools / local file tools for agents | [/mcp/](https://wyreup.com/mcp/) | `/skill/` explains choosing/invoking tools; `/cli/` serves shell workflows. | Audience and demand unmeasured. Distinguish local tool execution from assistant-provider data handling and hosted PRO. |
| Developer | CLI image compression / command line PDF tools | [/cli/](https://wyreup.com/cli/) | MCP and skill pages cover assistant integration. | Audience and demand unmeasured. Setup/model downloads and hosted calls limit offline availability. |

Unrelated visible queries such as `reevown` and `rewrapper` do not establish a need for new pages. Investigate their landing page and intent first. The home page describes the product, the tools page aids discovery, and categories organize real task families; they do not replace focused task pages.

The original isolated SEO release's capability check used committed `origin/main` source rather than the original dirty core. It found that `image-similarity/index.ts` called the text `feature-extraction` pipeline with a data URL, while the installed Transformers text pipeline tokenized that string instead of processing image pixels. That release labelled the tool experimental, warned against duplicate/deletion decisions and narrowed related explanatory copy. It corrected copy without changing or accepting the runtime.

The subsequent dependency remediation corrects the runtime to decoded image
feature extraction. Actual Node and built Chrome workflows return cosine 1 for
duplicate fixtures, a lower score for a distinct fixture, the expected groups,
matching downloaded JSON and a cached repeat. Current copy describes this
behavior with manual-review limits. These fixtures establish compatibility,
not general duplicate-detection accuracy or search-ranking gains. ONNX runtime
asset delivery and live acceptance remain part of the release checks.

## Local implementation and release checks

Canonical, Open Graph, Twitter and structured-data page URLs share a production-origin, trailing-slash policy without query/hash. Sitemap discovery covers all registry tools, task pages, category memberships and public docs/pricing/legal pages. Application workspaces and the 404 page are excluded and carry `noindex,follow`. Query-bearing tool launches and file URLs retain their functional form.

Five priority tool pages and three task pages receive visible instructions, supported inputs/outputs, practical examples, limitations and relevant links. Scoped titles/headings describe the actual task. The hand-maintained web copy overrides misleading generated statements without regenerating the entire catalog. Category and distribution copy distinguishes free local execution, asset downloads, network tasks and optional hosted PRO.

These changes remain local until a separately authorized release. A built sitemap is not the live sitemap. After release, check the Cloudflare deploy conclusion and fetch the actual changed URLs and `/sitemap.xml`; then inspect priority URLs in Search Console. Submit or request reindexing only for content that is actually live. Retain the project release gates in `AGENTS.md`.

Public npm registry lookup on October 8 found CLI `0.7.17` and MCP `0.7.16` with published tarballs, so “npm publish is imminent” was stale. This observation does not establish package/source parity or authorize publishing.

## Weekly manual review

1. Open the verified domain property. Record the review date, latest complete report date, search type and all active filters. Export a consistent last-28-complete-days Performance report and compare the preceding 28 days. Also retain a three-month view for context. Do not mix partial days with complete periods.
2. Review queries and pages for each cluster. Record clicks, impressions, CTR and average position, then segment relevant changes by country and device. Separate branded/site-search queries from task intent. Note anonymized-query omissions and differences between page and property aggregation.
3. Check Page indexing and sitemap status. Inspect priority URLs for crawl availability, declared versus Google-selected canonical and index status. Review samples of crawled/discovered not indexed, real 404 and soft-404 URLs. Keep expected redirects and legitimate canonical alternatives as exclusions.
4. Choose a small evidence-led improvement: mismatched title for a shown query, missing supported-file explanation, weak instructions, unclear limitation or useful missing link. Record what changed, why and the live deployment date. Do not repeatedly rewrite titles based on a handful of impressions.
5. Compare the same page/query groups before and after the live change, holding report settings constant. Allow for indexing/reporting delay, seasonality, device/country mix and competing changes. New impressions, clicks or position movements are observations, not proof that a particular edit caused them.
6. Review the map monthly. Add a page only for a distinct task the product actually handles and for which the page can supply useful instructions. Retain low-sample results rather than claiming a percentage uplift or ranking success.

Keep dated exports and review notes locally using the same fields. Never put secrets, private keys, authentication URLs or user files into demonstrations. This plan does not automate exports or reviews.

## Ready-to-use guide and distribution drafts

The following drafts are complete copy for human review. They have not been published or sent. Record actual demonstration results only after running and inspecting them; no measured savings or before/after claims are invented here.

### Guide: Remove location data before sharing a photo

A photo can carry GPS coordinates, camera details and capture time in its metadata. Before posting a marketplace photo or sending one to someone you do not know, create a sharing copy with those fields removed.

Open [Remove photo location data](https://wyreup.com/remove-photo-location-data/), select a JPEG, PNG or WebP image, run the cleanup and download the result. For an iPhone HEIC file, [convert it to JPG first](https://wyreup.com/convert-heic-to-jpg/). The cleanup decodes and re-encodes the image locally at quality 95, leaving the source file on your device. Re-encoding can change appearance or size.

Check the downloaded copy in a local EXIF viewer. Then look at the visible image: signs, reflections, house numbers and landmarks can still reveal a location. If people are visible, [blur detected faces](https://wyreup.com/tools/face-blur/) and inspect every person for missed detection. Metadata removal and blur do not guarantee anonymity. Share the reviewed download rather than the original photo.

### Demonstration script: Check face blur before posting

Use a staged photo with consent from the people pictured. Open [Blur faces](https://wyreup.com/tools/face-blur/) and select a JPEG, PNG or WebP under the 50 MB input limit. Explain that the first run downloads the face detector/runtime, while the selected image is processed on the device. Run the tool, open the PNG output at full size and inspect each person, including the background. Point out any missed face rather than hiding it. Use [region pixelation](https://wyreup.com/tools/pixelate-region/) for a selected area when needed. End by showing the output checks and reminding viewers that clothing, reflections and location clues remain visible.

### Guide: Prepare an iPhone photo for an email or JPG-only form

If a form or recipient cannot open your HEIC photo, open [Convert HEIC to JPG](https://wyreup.com/convert-heic-to-jpg/), select the HEIC/HEIF still image and download its JPEG copy. Open the copy before sending it. The conversion exports the first still image; it does not include Live Photo motion or sound. Use the [full converter](https://wyreup.com/tools/heic-to-jpg/) when you need PNG/WebP output or quality settings.

If the JPEG exceeds your attachment limit, use [Compress a photo for email](https://wyreup.com/compress-photo-for-email/). Compare the downloaded size with your email provider's limit, including the combined size of other attachments. Check small text and important details. If necessary, [adjust compression quality](https://wyreup.com/tools/compress/) or [reduce dimensions](https://wyreup.com/tools/resize/). Savings depend on the original; a compressor may keep the original bytes when re-encoding is larger. There is no guaranteed output size.

### Community post draft: Photo sharing checklist

Before sharing a photo, I check two things: hidden metadata and visible details. Wyreup has a [photo location-data cleanup](https://wyreup.com/remove-photo-location-data/) for JPEG, PNG and WebP and an [on-device face blur tool](https://wyreup.com/tools/face-blur/). The face detector downloads assets when needed, and detection can miss people, so review the whole output. Metadata cleanup re-encodes the photo and does not hide landmarks or signs. The linked pages explain the supported formats and checks. If you try them with a non-sensitive test image, feedback on unclear instructions or missed cases would help.

Post only where relevant to an actual discussion and allowed by community rules; disclose affiliation when posting as the maker. No posts are sent by this plan.

### Editor outreach draft: A practical file-privacy guide

Subject: Photo metadata and face-blur checks for your file-privacy guide

Your readers may find a short, practical checklist useful: remove EXIF/GPS from a sharing copy, inspect the visible scene, and review every face after automatic blur. Wyreup's [metadata cleanup](https://wyreup.com/remove-photo-location-data/) and [face blur](https://wyreup.com/tools/face-blur/) pages include supported formats and limitations. Cleanup re-encodes locally; face detection needs model/runtime downloads and can miss people. Neither operation guarantees anonymity. If relevant to your guide, the task pages can serve as examples readers can inspect with their own non-sensitive test images. I am the site's maker and can clarify the execution details.

Choose a genuinely relevant editor and personalize the first sentence using verified context before sending. Do not invent an existing article, endorsement or result. Sending requires the operator's explicit instruction.
