# Role intake sources

- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/): the browser receives a short-lived signed PUT URL, while R2 credentials remain server-side. The signed content type is verified when the object is finalized.
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/): the private bucket must allow the console origin to `PUT` role uploads with the `content-type` request header.
- [Railway Docker Compose service mapping](https://docs.railway.com/guides/docker-compose): Railway services should run as independently configured private services rather than expose the scanner publicly.
- [Official ClamAV Docker image](https://hub.docker.com/r/clamav/clamav): local development uses the maintained ClamAV daemon image behind the optional `role-intake` Docker profile.
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): URL imports validate every DNS answer, reject non-public address ranges and keep redirect handling under application control.
- [Node.js HTTP request options](https://nodejs.org/api/http.html#httprequestoptions-callback) and [Node.js DNS lookup](https://nodejs.org/api/dns.html#dnspromiseslookuphostname-options): the importer resolves all addresses, then pins one validated address into the TLS request rather than letting a later hostname lookup bypass validation.
- [RFC 9110 redirects](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4): every redirect target is an independent request URI and is therefore parsed and validated again.
- [RFC 9309 robots](https://www.rfc-editor.org/rfc/rfc9309.html): the importer identifies itself as `PreludeRoleImporter` and honors the matching `robots.txt` policy before retrieving a job page.

The importer deliberately does not use OCR, an LLM, browser automation, public preview URLs, or a document download endpoint. PDF/DOCX input is malware-scanned before deterministic extraction. Public URL input is retrieved once through a bounded, non-executing HTML parser. Recruiter-approved role fields, not raw documents or raw HTML, are later sent to the configured question-generation provider.
