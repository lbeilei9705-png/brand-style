#!/bin/zsh

set -euo pipefail

PROJECT_DIR="${0:A:h}"
LOG_FILE="${TMPDIR:-/tmp}/brand-style-plugin-update.log"
ARCHIVE_URL="${BRAND_STYLE_PLUGIN_ARCHIVE_URL:-https://github.com/lbeilei9705-png/brand-style/archive/refs/heads/main.zip}"
GENERATED_FILES=(
  "apps/figma-plugin/dist/ui.html"
  "apps/figma-plugin/dist/code.js"
)

exec > >(tee "$LOG_FILE") 2>&1
cd "$PROJECT_DIR"

show_dialog() {
  local title="$1"
  local message="$2"
  [[ "${BRAND_STYLE_PLUGIN_NO_UI:-}" == "1" ]] && return
  /usr/bin/osascript - "$title" "$message" >/dev/null 2>&1 <<'APPLESCRIPT' || true
on run argv
  display dialog (item 2 of argv) with title (item 1 of argv) buttons {"知道了"} default button "知道了"
end run
APPLESCRIPT
}

fail_update() {
  local message="$1"
  print "\n更新失败：${message}"
  print "日志：${LOG_FILE}"
  show_dialog "品牌插件更新失败" "${message}\\n\\n日志：${LOG_FILE}"
  exit 1
}

print "正在检查品牌插件更新环境…"

[[ -f "apps/figma-plugin/manifest.json" ]] || fail_update "更新工具必须放在品牌插件项目根目录。"

has_build_environment=false
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  if node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 6)) process.exit(1);
  '; then
    has_build_environment=true
  fi
fi

if [[ "${1:-}" == "--check" ]]; then
  print "检查通过：插件目录可用。"
  [[ "$has_build_environment" == true ]] && print "已检测到本地构建环境。" || print "将使用仓库内的预构建插件。"
  exit 0
fi

version="main 最新版"
if [[ -d ".git" ]] && command -v git >/dev/null 2>&1; then
  git diff --quiet -- . \
    ":(exclude)apps/figma-plugin/dist/ui.html" \
    ":(exclude)apps/figma-plugin/dist/code.js" \
    || fail_update "检测到本地代码修改。为避免覆盖，请先联系维护人员处理。"

  git diff --cached --quiet -- . \
    ":(exclude)apps/figma-plugin/dist/ui.html" \
    ":(exclude)apps/figma-plugin/dist/code.js" \
    || fail_update "检测到尚未提交的代码。为避免覆盖，请先联系维护人员处理。"

  untracked_files="$(git ls-files --others --exclude-standard)"
  [[ -z "$untracked_files" ]] || fail_update "检测到项目中有未跟踪文件。为避免覆盖，请先联系维护人员处理。"

  upstream="$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)" \
    || fail_update "当前分支没有远程更新来源。"
  lock_before=""
  [[ -f "package-lock.json" ]] && lock_before="$(shasum -a 256 package-lock.json | awk '{print $1}')"

  # 构建文件包含当前提交号，因此允许更新工具安全地重新生成这两个文件。
  git restore --worktree -- "${GENERATED_FILES[@]}" 2>/dev/null || true
  print "正在下载最新版本…"
  git fetch --prune origin || fail_update "下载失败，请检查网络或 GitHub 访问权限。"
  git merge --ff-only "$upstream" || fail_update "本地分支与远程版本发生分叉，请联系维护人员处理。"
  version="$(git rev-parse --short HEAD)"

  lock_after=""
  [[ -f "package-lock.json" ]] && lock_after="$(shasum -a 256 package-lock.json | awk '{print $1}')"
  if [[ "$has_build_environment" == true ]]; then
    if [[ ! -d "node_modules" || "$lock_before" != "$lock_after" ]]; then
      print "正在安装项目依赖…"
      npm ci || fail_update "依赖安装失败。"
    fi
    print "正在构建 Figma 插件…"
    npm run build --workspace @icon-style/figma-plugin || fail_update "插件构建失败。"
    npm run check --workspace @icon-style/figma-plugin || fail_update "插件检查失败。"
  fi
else
  command -v curl >/dev/null 2>&1 || fail_update "没有找到系统下载工具 curl。"
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/brand-style-update.XXXXXX")"
  trap 'rm -rf "$temp_dir"' EXIT
  print "正在下载最新版本…"
  curl --fail --location --retry 2 --connect-timeout 15 --max-time 180 --silent --show-error "$ARCHIVE_URL" -o "$temp_dir/plugin.zip" \
    || fail_update "下载失败，请检查网络或仓库访问权限。"
  ditto -x -k "$temp_dir/plugin.zip" "$temp_dir/unpacked" \
    || fail_update "无法解压更新文件。"
  unpacked_dirs=("$temp_dir/unpacked"/*(/N))
  source_dir="${unpacked_dirs[1]:-}"
  [[ -n "$source_dir" && -f "$source_dir/apps/figma-plugin/manifest.json" && -f "$source_dir/apps/figma-plugin/dist/ui.html" ]] \
    || fail_update "下载内容不完整，已停止更新。"
  ditto "$source_dir" "$PROJECT_DIR" || fail_update "无法写入插件目录。"
  chmod +x "$PROJECT_DIR/更新Figma插件.command" 2>/dev/null || true
fi

print "\n更新完成，当前版本：${version}"
print "请关闭正在运行的插件，然后在 Figma 中重新打开。"
show_dialog "品牌插件更新完成" "当前版本：${version}\\n\\n请关闭正在运行的插件，然后在 Figma 中重新打开。"
