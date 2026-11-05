#!/usr/bin/env bash
# DayBook 服务器本机构建 + 部署脚本
# 由 Gitee Go 流水线在主机组（121.89.86.53）上通过 shell@agent 调用。
# 也可手动执行：bash /opt/daybook/daybook/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/daybook/daybook}"
WEB_ROOT="${WEB_ROOT:-/usr/local/nginx/html}"
GIT_REMOTE="${GIT_REMOTE:-https://gitee.com/cty1735/daybook.git}"
BRANCH="${BRANCH:-master}"
SERVICE="${SERVICE:-daybook-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"

export PATH=/usr/local/node22/bin:$PATH
# 构建内存上限：实测 vite/tsc 峰值 ~170MB，留足余量但仍避免吃满 1.8GB
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"

log() { printf '\033[1;36m[deploy] %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m[deploy] 失败: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 0. 前置检查 ----------
[ -d "$APP_DIR" ] || fail "APP_DIR 不存在: $APP_DIR"
cd "$APP_DIR"

# ---------- 1. 同步代码 ----------
if [ ! -d .git ]; then
  log "初始化 git 仓库"
  git init -q
  git remote add origin "$GIT_REMOTE"
fi

log "拉取 $BRANCH 最新代码"
git fetch -q origin "$BRANCH"
git reset -q --hard FETCH_HEAD

COMMIT="$(git rev-parse --short HEAD)"
log "当前提交: $COMMIT  $(git log -1 --pretty=%s)"

# ---------- 2. 安装依赖 ----------
log "安装依赖"
pnpm install --prod=false --reporter=append-only

# ---------- 3. 构建 ----------
log "构建 web (base=/daybook/)"
pnpm -F @daybook/web exec vite build --base=/daybook/

log "构建 admin (base=/admin/)"
pnpm -F @daybook/admin build

log "类型检查 api"
pnpm -F @daybook/api build

# ---------- 4. 发布静态文件（原子切换） ----------
publish() {
  local name="$1" src="$2"
  [ -d "$src" ] || fail "构建产物缺失: $src"
  rm -rf "$WEB_ROOT/.${name}.new"
  cp -a "$src" "$WEB_ROOT/.${name}.new"
  rm -rf "$WEB_ROOT/${name}"
  mv "$WEB_ROOT/.${name}.new" "$WEB_ROOT/${name}"
  log "已发布 $name -> $WEB_ROOT/$name"
}

publish daybook apps/web/dist
publish admin   apps/admin/dist

# ---------- 5. 重启后端 ----------
log "重启 $SERVICE"
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || fail "$SERVICE 未能启动，查看: journalctl -u $SERVICE -n 50"

# ---------- 6. 健康检查 ----------
log "健康检查 $HEALTH_URL"
for i in 1 2 3 4 5; do
  if curl -fsS --max-time 5 "$HEALTH_URL"; then
    echo
    log "部署完成 ✓ commit=$COMMIT"
    exit 0
  fi
  sleep 2
done

fail "健康检查未通过"
