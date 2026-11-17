# LiveKit Cloud builds and runs this image (lk agent create / lk agent deploy).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agent.py prompts.py ./
# Downloads model files the framework needs, so the first meeting does not wait.
RUN python agent.py download-files

CMD ["python", "agent.py", "start"]
