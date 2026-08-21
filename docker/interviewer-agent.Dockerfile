FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libportaudio2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/interviewer-agent/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt

COPY services/interviewer-agent/app ./app

CMD ["python", "-m", "app.auto_worker"]
