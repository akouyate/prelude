# Role intake quality sources

This document records the primary and authoritative references behind the
bounded quality slice for PDF/DOCX role intake. The pilot scorecard stores only
structural observations, timestamps, categorical review labels, and aggregate
results. It does not persist customer document text, filenames, URLs, hashes,
extracted fields, or reviewer notes.

## Upload and parser safety

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

The intake boundary follows OWASP's guidance to validate the declared type and
file signature, enforce size and storage controls, treat uploaded files as
untrusted, and keep parser and malware handling separate from product-quality
measurement. Warning metadata is therefore represented by bounded codes, not
raw parser messages or document fragments.

## Extraction quality and ground truth

- [A Benchmark for PDF Text Extraction](https://ad-publications.cs.uni-freiburg.de/benchmark.pdf)
- [Methods for Evaluating Text Extraction Toolkits](https://www.mitre.org/sites/default/files/publications/pr-15-0185-methods-for-evaluating-text-extraction-toolkits.pdf)
- [A Multi-Task Benchmark for Document Structure Understanding](https://arxiv.org/abs/2303.09957)

PDF is a layout format rather than a plain-text container. The corpus therefore
uses accepted title aliases and required description fact groups instead of raw
full-text equality. This makes whitespace, line wrapping, pagination, accents,
and layout changes observable without treating harmless extraction differences
as product failures. Scanned/no-text and corrupt inputs are expected outcomes,
not fabricated extraction successes.

## Metrics and cardinality

- [OpenTelemetry metrics concepts](https://opentelemetry.io/docs/concepts/signals/metrics/)
- [OpenTelemetry metrics data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)

The implementation uses the existing first-party intake event boundary and pure
aggregation functions. It does not add an analytics SDK. Event dimensions stay
bounded to format, locale, outcome, size/page/text buckets, warning codes, and
durations; document identifiers and content are excluded to control cardinality
and privacy exposure. Latency uses nearest-rank p95 and median values so the
scorecard is deterministic and reproducible in tests.

## Pilot interpretation

The fixture corpus is synthetic and runs in memory. It is not evidence of
customer performance. All sample-dependent gates remain `insufficient_data`
until at least 50 eligible pilot assessments exist; the speed comparison also
requires a matched manual-baseline observation for every pilot assessment.
