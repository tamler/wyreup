# Bank statement fixtures

These are original synthetic fixtures authored for Wyreup. They contain invented transactions, no user files or account identifiers, and are distributed under this repository's MIT license. No external PDF was copied or downloaded.

`bank-fixtures.ts` constructs complete PDF documents with the already installed MIT-licensed `pdf-lib` 1.17.1. It embeds standard Helvetica and Courier text; the tiny PNG is constructed from literal RGBA bytes, standard CRC32, and the Node zlib encoder. The fixture generator does not import the bank parser, reviewer, CSV serializer or worker implementation. `bank-expected-data.json` records independently specified column intervals, source ordering, decisions and exact arithmetic. Generated PDF metadata dates may differ on regeneration; the hashes below identify the actual checked-in fixture bytes used for acceptance.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| bank-known.pdf | 2777 | 389eb047855f1b1983d6edb1cac80ded72b712eee57a125d22b9f9579f0312a8 |
| bank-fragmented.pdf | 3241 | 8cfa2fc4992630a5bee845680ab5edf512f5981a5e907dde03c67329b49d1bae |
| bank-blank.pdf | 2896 | 8c8b80d044204a25efcdcf5b17ef5e22f2bdfeb941c5bf6e58661edfc174ba97 |
| bank-scan.pdf | 3352 | 3a43e00f73af0499aff5313e126d35870ffc05f8c0088a81f017888312379e51 |
| bank-mixed.pdf | 3036 | e20a84bc4f695f84e5262febfd746e08ceb16b0de7fe3ada030c7953fcb048a5 |
| bank-unknown.pdf | 3352 | ffcc0ec89ddec001ffbdb5a5eb3fdf2b7c02fe137754b777de6642b569816f5e |
| bank-rotated.pdf | 2823 | 3fca4278206686642072ca7d1419549aedc4b52a40b8f50907fce959344e06c3 |
| bank-many-pages.pdf | 14581 | 0786e8495e1049996245b2433c91c6245dba3f64564b960c016523314449ca2b |
| bank-debit-credit.pdf | 2775 | 13e3e2bbf42c6139b739675159a3fc5c83da94794e0b1467fded9b9d4b303e01 |

The complete known statement sums accepted transaction-role amounts only: -12.34 + 25.00 - 100.00 = -87.34. Opening 1000.00 plus this sum equals the printed closing 912.66. Explicitly ignoring the -100.00 transfer retains printed closing 912.66 and yields delta +100.00, with exceptions. The literal source row and its valid amount remain in the exported CSV. Opening/closing and attached description rows are retained but never added to that sum.

The over-limit raster is deliberately not interpreted as a blank page. Its untouched 2 by 2 fixture exposed installed PDF SDK operator-list error ordering; baseline failures and the SDK correction are tracked in the external evidence directory. The required result remains `unknown`, with explicit page review before export. Synthetic fixtures establish these specific layouts and failure conditions, not general compatibility with arbitrary banks, scanned statements or encodings.
