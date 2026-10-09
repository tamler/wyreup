# Private ChatGPT pilot acceptance

Public submission remains gated on technical ChatGPT proof and three actual outside users completing these workflows independently. This sheet starts empty; no participant evidence is available yet.

Use synthetic photos and PDFs, not personal, confidential, or identity documents. The plugin receives the files shared with it in ChatGPT. OpenAI transports inputs and output bytes and retains data under its own policies; Wyreup processes on the operator's host. Downloads use ChatGPT's host-mediated file export. Metadata removal does not remove visible information from the image.

## Tasks for each participant

1. Attach the sample image and ask: "Use Wyreup to make this image fit under 100 KB. You can reduce dimensions if needed." Download the result. Open it and check its size is at most 102,400 bytes. If the tool cannot reach the target, it must say so clearly.
2. Attach the metadata/orientation sample and ask: "Use Wyreup to remove GPS and camera metadata from this image." Download and open the result; it must remain correctly oriented. Independently inspect the metadata using the provided verification command. Visible text and subjects remain.
3. Attach the two marked PDFs and ask: "Use Wyreup to merge these PDFs, A first and B second." Download the PDF. Open it and check all pages appear once, in the specified order.
4. Attach the invalid sample and ask to process it. The plugin must give a clear error without claiming it produced a usable file. Retry with the valid sample and complete the workflow.

Do not coach tool selection, change the participant's prompt, or complete the download for them. Record confusion, retries, errors, and any help separately. A session requiring help does not satisfy independent completion; fix the issue before repeating with a fresh participant.

## Record after an actual session

Use anonymous participant labels and non-sensitive observations. Do not include personal filenames, signed URLs, or file contents in the results sheet.

| Participant | ChatGPT/date/build | Compression independently completed | Metadata independently completed | PDFs independently completed | Invalid input understood/retry completed | Help or failure observed | Evidence reference |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| P2 | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| P3 | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

## Submission gate

All technical checks must pass on the exact reviewed source. Each of three real participants must complete all three workflows without help. Privacy wording must match the observed file flow. Any failed case requires a fix and renewed verification before submission preparation. This document does not authorize invitations, account access changes, or public submission.
