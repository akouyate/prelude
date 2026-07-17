# Role intake sources

- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/): the browser receives a short-lived signed PUT URL, while R2 credentials remain server-side. The signed content type is verified when the object is finalized.
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/): the private bucket must allow the console origin to `PUT` role uploads with the `content-type` request header.
- [Railway Docker Compose service mapping](https://docs.railway.com/guides/docker-compose): Railway services should run as independently configured private services rather than expose the scanner publicly.
- [Official ClamAV Docker image](https://hub.docker.com/r/clamav/clamav): local development uses the maintained ClamAV daemon image behind the optional `role-intake` Docker profile.

The importer deliberately does not use OCR, an LLM, public preview URLs, or a document download endpoint. It only extracts deterministic text after a malware scan. Recruiter-approved role fields, not raw documents, are later sent to the configured question-generation provider.
