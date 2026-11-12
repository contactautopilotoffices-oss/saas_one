# voice-id on Hugging Face Spaces (Docker Space, free "CPU basic": 2 vCPU, 16 GB RAM).
# Spaces run the container as user 1000 and send traffic to port 7860.
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    TORCH_THREADS=2
WORKDIR /home/user/app

# CPU-only PyTorch (the default build pulls GPU libraries we do not need)
RUN pip install --no-cache-dir --user torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cpu
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Download the voice model once, while building, so a cold start does not wait for it.
# Set MODEL_REVISION to a commit id of speechbrain/spkrec-ecapa-voxceleb to pin the exact model.
ARG MODEL_REVISION=main
ENV MODEL_REVISION=${MODEL_REVISION} MODEL_DIR=/home/user/app/model MODEL_RUN_DIR=/home/user/app/model_run
RUN python -c "import os; from huggingface_hub import snapshot_download; snapshot_download('speechbrain/spkrec-ecapa-voxceleb', revision=os.environ['MODEL_REVISION'], local_dir=os.environ['MODEL_DIR'])"

COPY --chown=user app.py audio.py matching.py ./

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
