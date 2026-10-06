#!/bin/zsh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "正在启动 Sentinel RGBT 光伏双模态巡检平台..."
echo "项目目录：$ROOT"
echo ""

API_PID=""
WEB_PID=""
ENTRY_PATH="/command-center"

cleanup() {
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [[ ! -x "$ROOT/.venv/bin/uvicorn" ]]; then
  echo "首次启动：正在创建 Python 环境并安装后端依赖..."
  python3 -m venv "$ROOT/.venv"
  "$ROOT/.venv/bin/python" -m pip install -r "$ROOT/backend/requirements.txt"
fi

if ! "$ROOT/.venv/bin/python" -c "import ultralytics, torch" >/dev/null 2>&1; then
  echo "首次启用真实检测：正在安装 YOLO 推理依赖..."
  "$ROOT/.venv/bin/python" -m pip install -r "$ROOT/backend/requirements-ml.txt"
fi

if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "首次启动：正在安装前端依赖..."
  (cd "$ROOT/frontend" && npm install)
fi

API_PORT=8000
while lsof -nP -iTCP:$API_PORT -sTCP:LISTEN >/dev/null 2>&1; do
  API_PORT=$((API_PORT + 1))
done

WEB_PORT=5173
while lsof -nP -iTCP:$WEB_PORT -sTCP:LISTEN >/dev/null 2>&1; do
  WEB_PORT=$((WEB_PORT + 1))
done

echo "本次端口：前端 $WEB_PORT，后端 $API_PORT"
(cd "$ROOT/backend" && ALLOWED_ORIGINS="http://127.0.0.1:$WEB_PORT" PYTHONPYCACHEPREFIX=/tmp/sentinel-pycache "$ROOT/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$API_PORT") &
API_PID=$!

(cd "$ROOT/frontend" && VITE_API_BASE_URL="http://127.0.0.1:$API_PORT/api/v1" npm run dev -- --host 127.0.0.1 --port "$WEB_PORT" --strictPort) &
WEB_PID=$!

for attempt in {1..40}; do
  if curl -fsS "http://127.0.0.1:$WEB_PORT$ENTRY_PATH" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! curl -fsS "http://127.0.0.1:$WEB_PORT$ENTRY_PATH" >/dev/null 2>&1; then
  echo "前端启动失败，请查看上方日志。"
  exit 1
fi

if ! curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
  echo "后端启动失败，请查看上方日志。"
  exit 1
fi

open "http://127.0.0.1:$WEB_PORT$ENTRY_PATH"
echo "浏览器已打开：http://127.0.0.1:$WEB_PORT$ENTRY_PATH"
echo "关闭本窗口即可停止本次启动的服务。"
echo ""

wait "$WEB_PID"
