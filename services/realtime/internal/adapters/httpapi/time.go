package httpapi

import "time"

type domainTime = time.Time

func parseRFC3339(value string) (domainTime, error) {
	return time.Parse(time.RFC3339Nano, value)
}
