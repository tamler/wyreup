---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Three new PRO tools, 1 credit each, for working with lists of text. Find Similar Text (`text-find-similar-pro`) ranks up to 100 items by meaning against a target text using hosted BGE-M3 multilingual embeddings. Rank Results (`rank-results-pro`) scores up to 100 passages against a question with the hosted BGE reranker, which is trained on English and Chinese. Group Similar Text (`text-cluster-pro`) sorts 3 to 100 items into 2 to 10 numbered groups with k-means on BGE-M3 embeddings and shows the most typical item of each group. Input is one item per line or a JSON array of strings; output is CSV by default, or JSON. Each run takes up to 50,000 characters in total (4,000 per item; 2,000 per passage and a 500-character question for Rank Results), and over-limit input is refused before any credits are spent.
