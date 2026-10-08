FROM python:3.11-slim

# libgl1/libglib2.0-0 are required by opencv-contrib-python-headless's native deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Pre-download the rembg model at build time so cold starts don't pay for it
# (NudeNet ships its model inside the package).
RUN python -c "from app.pipeline.bg_removal import _rembg_session; _rembg_session()"

# glibc gives every thread its own malloc arena and rarely hands freed
# memory back, so RSS keeps the peak of every large numpy/OpenCV buffer.
# Two arenas keeps long-running memory close to what's actually in use.
ENV MALLOC_ARENA_MAX=2
# One job at a time by default - see MAX_CONCURRENT_JOBS / JOB_THREADS in
# app/config.py. Raise it on a bigger machine.
ENV MAX_CONCURRENT_JOBS=1
ENV ALLOWED_ORIGINS="*"
EXPOSE 8000

# Hypercorn rather than uvicorn: Cloud Run caps HTTP/1 request bodies at
# 32 MB, and the browser uploads videos straight here, so the service runs
# with "Use HTTP/2 end-to-end" on - which needs a server that speaks HTTP/2
# cleartext (h2c), as hypercorn does. Listens on $PORT (Cloud Run sets it),
# 8000 otherwise. Long jobs are bounded by the Cloud Run request timeout and
# _run_pipeline_job, not by hypercorn.
CMD ["sh", "-c", "exec hypercorn app.main:app --bind 0.0.0.0:${PORT:-8000}"]
