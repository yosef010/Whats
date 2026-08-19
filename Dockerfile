FROM python:3.11-slim

# تثبيت الحزم المطلوبة للنظام
RUN apt-get update && apt-get install -y \
    ca-certificates \
    build-essential \
    ffmpeg \
    libsqlite3-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]
