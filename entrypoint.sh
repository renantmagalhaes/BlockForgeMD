#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

# If the group doesn't exist, create it
if ! getent group "$PGID" > /dev/null 2>&1; then
  groupadd -g "$PGID" appgroup
fi

# If the user doesn't exist, create it
if ! getent passwd "$PUID" > /dev/null 2>&1; then
  useradd -u "$PUID" -g "$PGID" -M -s /sbin/nologin appuser
fi

# Ensure the workspace directory exists and is owned by the runtime user
mkdir -p /workspace
chown -R "$PUID:$PGID" /workspace

# Drop privileges and exec the application
exec gosu "$PUID:$PGID" /app/blockforgemd-backend -workspace /workspace -port 8080
