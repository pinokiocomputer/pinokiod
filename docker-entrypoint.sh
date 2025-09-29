#!/usr/bin/env bash
set -euo pipefail

if [ -z "${PINOKIO_STDOUT_STREAMED:-}" ] && command -v stdbuf >/dev/null 2>&1; then
  export PINOKIO_STDOUT_STREAMED=1
  exec 1> >(stdbuf -oL cat)
  exec 2> >(stdbuf -oL cat >&2)
fi

PINOKIO_HOME="${PINOKIO_HOME:-/data/pinokio}"
export PINOKIO_HOME

if [ ! -d "$PINOKIO_HOME/bin" ]; then
  mkdir -p "$PINOKIO_HOME"
  if [ -f "/app/.pinokio-seed.tgz" ]; then
    echo "[entrypoint] Bootstrapping Pinokio home at $PINOKIO_HOME"
    echo "[entrypoint] Extracting Pinokio seed archive (this may take a moment)"
    if command -v pv >/dev/null 2>&1; then
      step=${PINOKIO_PROGRESS_STEP:-5}
      interval=${PINOKIO_PROGRESS_INTERVAL:-1}
      progress_fifo_raw=$(mktemp -t pinokio-progress-raw.XXXXXX)
      progress_fifo=$(mktemp -t pinokio-progress.XXXXXX)
      rm -f "$progress_fifo_raw" "$progress_fifo"
      mkfifo "$progress_fifo_raw" "$progress_fifo"
      (
        trap 'rm -f "$progress_fifo_raw" "$progress_fifo"; exit 0' EXIT INT TERM
        tr '\r' '\n' <"$progress_fifo_raw" >"$progress_fifo"
      ) &
      progress_transform_pid=$!
      (
        last=-1
        while IFS= read -r line; do
          progress=$(printf '%s\n' "$line" | grep -oE '[0-9]+%' | tail -n 1 || true)
          if [ -n "$progress" ]; then
            pct=${progress%%%}
            if [ "$pct" -gt "$last" ]; then
              delta=$((pct - last))
              if [ "$pct" -eq 100 ] || [ "$delta" -ge "$step" ] || [ "$last" -lt 0 ]; then
                last=$pct
                printf '[entrypoint] Extracting: %d%%\n' "$pct"
              fi
            fi
          fi
        done <"$progress_fifo"
        if [ "$last" -lt 100 ]; then
          printf '[entrypoint] Extracting: 100%%\n'
        fi
      ) &
      progress_reader_pid=$!
      pv -f -i "$interval" /app/.pinokio-seed.tgz 2>"$progress_fifo_raw" | tar -C "$PINOKIO_HOME" -xz -f -
      status=$?
      wait "$progress_reader_pid" || true
      wait "$progress_transform_pid" || true
      rm -f "$progress_fifo_raw" "$progress_fifo"
      if [ $status -ne 0 ]; then
        exit $status
      fi
    else
      tar -C "$PINOKIO_HOME" -xzf /app/.pinokio-seed.tgz
    fi
    echo "[entrypoint] Seed archive extraction complete"
  elif [ -d "/app/.pinokio-seed" ]; then
    echo "[entrypoint] Bootstrapping Pinokio home at $PINOKIO_HOME"
    echo "[entrypoint] Copying Pinokio seed directory"
    cp -a /app/.pinokio-seed/. "$PINOKIO_HOME"/
    echo "[entrypoint] Seed directory copy complete"
  fi
fi

if [ -e "/app/.pinokio-seed" ] && [ ! -L "/app/.pinokio-seed" ]; then
  rm -rf /app/.pinokio-seed
fi
ln -sfn "$PINOKIO_HOME" /app/.pinokio-seed

exec "$@"
