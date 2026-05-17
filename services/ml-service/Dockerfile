FROM python:3.13.13-slim

COPY services/ml-service/requirements.txt .
RUN pip install -r requirements.txt

WORKDIR /app

COPY services/ml-service /app
COPY libs/ /app/libs

EXPOSE 8087

CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8087"]