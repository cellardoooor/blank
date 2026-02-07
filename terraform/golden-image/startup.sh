#!/bin/bash
# This script is embedded in the Golden Image
# It runs on Instance Group VMs to start the application

exec > >(tee -a /var/log/messenger-startup.log) 2>&1
set -e

echo "=== Starting messenger at $(date) ==="

# Check .env file exists (passed via metadata)
if [ ! -f /opt/messenger/.env ]; then
  echo "ERROR: .env file not found at /opt/messenger/.env"
  echo "Make sure metadata includes the environment variables"
  exit 1
fi

echo "Loading environment variables..."
set -a
source /opt/messenger/.env
set +a

echo "Starting Docker container..."
docker run -d \\
  --name messenger \\
  --restart unless-stopped \\
  -p 8080:8080 \\
  --env-file /opt/messenger/.env \\
  ${docker_image}

echo "Waiting for container to start..."
sleep 5

# Verify container is running
if docker ps | grep -q messenger; then
  echo "SUCCESS: Container is running"
  echo "Testing health endpoint..."
  sleep 2
  curl -f http://localhost:8080/api/health && echo "Health check passed" || echo "Health check failed but container is running"
else
  echo "ERROR: Container failed to start"
  echo "Container logs:"
  docker logs messenger || echo "No logs available"
  exit 1
fi

echo "=== Messenger startup completed at $(date) ==="
