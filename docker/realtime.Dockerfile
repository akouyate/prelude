FROM golang:1.26-alpine AS build

WORKDIR /src

COPY services/realtime/go.mod services/realtime/go.sum ./
RUN go mod download

COPY services/realtime/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/realtime ./cmd/server

FROM alpine:3.23

RUN apk add --no-cache ca-certificates

COPY --from=build /out/realtime /usr/local/bin/realtime

EXPOSE 8080

CMD ["realtime"]
