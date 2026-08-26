FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN addgroup --system aiartist && adduser --system --ingroup aiartist aiartist

COPY pyproject.toml alembic.ini ./
COPY migrations ./migrations
COPY src ./src

RUN pip install --upgrade pip && pip install .

USER aiartist

EXPOSE 8000

CMD ["uvicorn", "ai_artist.app:app", "--host", "0.0.0.0", "--port", "8000"]
