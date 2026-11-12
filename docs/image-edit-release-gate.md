# Image editing: disabled preparation

Image editing is incomplete and unavailable. The server rejects the tool before admission, charging or model dispatch. The multipart encoder is not connected to a model, and the tool is not in the default registry.

DECISIONS: The proposed price is 2 credits per run and remains provisional. Published tile rates do not establish actual worst-case billing for this integration. Model quality, speed, privacy terms and runtime behavior remain untested. No paid inference was run.

Before an independently reviewed change can enable this tool, it needs bounded, worker-compatible image decoding and re-encoding, animation and malformed-input rejection, metadata removal, and actual output validation. It also needs a verified aspect-preserving size policy, shared request-key settlement, safe CLI/MCP output handling, explicit upload consent, provider cost and retention evidence, and a user-facing before-and-after workflow. The current square multipart dimensions are an offline contract fixture, not a settled resizing policy. A header-only image check does not establish that a complete file can be safely decoded.

No configuration switch can enable this partial implementation. A timeout cannot establish that a provider stopped billing, and a refunded failure may still cost money.
