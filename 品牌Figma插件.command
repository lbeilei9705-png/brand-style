#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DEFAULT_INSTALL_DIR="${BRAND_STYLE_PLUGIN_INSTALL_DIR:-${HOME}/BrandStyleFigmaPlugin}"
ARCHIVE_URL="${BRAND_STYLE_PLUGIN_ARCHIVE_URL:-https://github.com/lbeilei9705-png/brand-style/archive/refs/heads/main.zip}"
LOG_FILE="${TMPDIR:-/tmp}/brand-style-plugin-setup.log"
GENERATED_FILES=(
  "apps/figma-plugin/dist/ui.html"
  "apps/figma-plugin/dist/code.js"
)
temp_dir=""

exec > >(tee "$LOG_FILE") 2>&1

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

cleanup() {
  [[ -n "$temp_dir" && -d "$temp_dir" ]] && rm -rf "$temp_dir"
}
trap cleanup EXIT

fail_setup() {
  local message="$1"
  print "\n操作失败：${message}"
  print "日志：${LOG_FILE}"
  show_dialog "品牌插件操作失败" "${message}\n\n日志：${LOG_FILE}"
  exit 1
}

has_manifest() {
  [[ -f "$1/apps/figma-plugin/manifest.json" ]]
}

has_build_environment=false
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  if node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 6)) process.exit(1);
  '; then
    has_build_environment=true
  fi
fi

download_latest() {
  command -v curl >/dev/null 2>&1 || fail_setup "没有找到系统下载工具 curl。"
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/brand-style-plugin.XXXXXX")"
  print "正在下载最新插件…"
  curl --fail --location --retry 2 --connect-timeout 15 --max-time 180 --silent --show-error "$ARCHIVE_URL" -o "$temp_dir/plugin.zip" \
    || fail_setup "下载失败，请检查网络或仓库访问权限。"
  ditto -x -k "$temp_dir/plugin.zip" "$temp_dir/unpacked" \
    || fail_setup "无法解压插件文件。"
  unpacked_dirs=("$temp_dir/unpacked"/*(/N))
  DOWNLOADED_DIR="${unpacked_dirs[1]:-}"
  [[ -n "$DOWNLOADED_DIR" && -f "$DOWNLOADED_DIR/apps/figma-plugin/manifest.json" && -f "$DOWNLOADED_DIR/apps/figma-plugin/dist/ui.html" ]] \
    || fail_setup "下载内容不完整，已停止操作。"
}

install_plugin() {
  [[ ! -e "$DEFAULT_INSTALL_DIR" ]] \
    || fail_setup "安装目录已存在但不是有效插件：${DEFAULT_INSTALL_DIR}"
  download_latest
  mkdir "$DEFAULT_INSTALL_DIR" || fail_setup "无法创建安装目录：${DEFAULT_INSTALL_DIR}"
  ditto "$DOWNLOADED_DIR" "$DEFAULT_INSTALL_DIR" || fail_setup "无法写入安装目录。"
  chmod +x "$DEFAULT_INSTALL_DIR/品牌Figma插件.command" 2>/dev/null || true

  local manifest_path="$DEFAULT_INSTALL_DIR/apps/figma-plugin/manifest.json"
  [[ "${BRAND_STYLE_PLUGIN_NO_UI:-}" == "1" ]] || open -R "$manifest_path" || true
  print "\n首次安装完成：${DEFAULT_INSTALL_DIR}"
  print "Finder 已定位 manifest.json。请在 Figma 中只导入这一次。"
  show_dialog "品牌插件安装完成" "Finder 已定位 manifest.json。\n\n请在 Figma Desktop 中打开：插件 → 开发 → 从 manifest 导入插件，然后选择该文件。以后仍然双击同一个工具即可更新。"
}

update_git_project() {
  cd "$TARGET_DIR"
  git diff --quiet -- . \
    ":(exclude)apps/figma-plugin/dist/ui.html" \
    ":(exclude)apps/figma-plugin/dist/code.js" \
    || fail_setup "检测到本地代码修改。为避免覆盖，请先联系维护人员处理。"
  git diff --cached --quiet -- . \
    ":(exclude)apps/figma-plugin/dist/ui.html" \
    ":(exclude)apps/figma-plugin/dist/code.js" \
    || fail_setup "检测到尚未提交的代码。为避免覆盖，请先联系维护人员处理。"
  [[ -z "$(git ls-files --others --exclude-standard)" ]] \
    || fail_setup "检测到项目中有未跟踪文件。为避免覆盖，请先联系维护人员处理。"

  local upstream
  upstream="$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)" \
    || fail_setup "当前分支没有远程更新来源。"
  local lock_before=""
  [[ -f "package-lock.json" ]] && lock_before="$(shasum -a 256 package-lock.json | awk '{print $1}')"
  git restore --worktree -- "${GENERATED_FILES[@]}" 2>/dev/null || true

  print "正在下载最新版本…"
  git fetch --prune origin || fail_setup "下载失败，请检查网络或 GitHub 访问权限。"
  git merge --ff-only "$upstream" || fail_setup "本地分支与远程版本发生分叉，请联系维护人员处理。"
  CURRENT_VERSION="$(git rev-parse --short HEAD)"

  local lock_after=""
  [[ -f "package-lock.json" ]] && lock_after="$(shasum -a 256 package-lock.json | awk '{print $1}')"
  if [[ "$has_build_environment" == true ]]; then
    if [[ ! -d "node_modules" || "$lock_before" != "$lock_after" ]]; then
      print "正在安装项目依赖…"
      npm ci || fail_setup "依赖安装失败。"
    fi
    print "正在构建 Figma 插件…"
    npm run build --workspace @icon-style/figma-plugin || fail_setup "插件构建失败。"
    npm run check --workspace @icon-style/figma-plugin || fail_setup "插件检查失败。"
  fi
}

update_downloaded_plugin() {
  download_latest
  ditto "$DOWNLOADED_DIR" "$TARGET_DIR" || fail_setup "无法写入插件目录。"
  chmod +x "$TARGET_DIR/品牌Figma插件.command" 2>/dev/null || true
  rm -f "$TARGET_DIR/首次安装Figma插件.command" "$TARGET_DIR/更新Figma插件.command"
}

print "正在检查品牌 Figma 插件…"
if has_manifest "$SCRIPT_DIR"; then
  TARGET_DIR="$SCRIPT_DIR"
elif has_manifest "$DEFAULT_INSTALL_DIR"; then
  TARGET_DIR="$DEFAULT_INSTALL_DIR"
else
  if [[ "${1:-}" == "--check" ]]; then
    print "检查通过：当前为首次安装模式，安装位置是 ${DEFAULT_INSTALL_DIR}。"
    exit 0
  fi
  install_plugin
  exit 0
fi

if [[ "${1:-}" == "--check" ]]; then
  print "检查通过：当前为更新模式，插件位置是 ${TARGET_DIR}。"
  exit 0
fi

CURRENT_VERSION="main 最新版"
if [[ -d "$TARGET_DIR/.git" ]] && command -v git >/dev/null 2>&1; then
  update_git_project
else
  update_downloaded_plugin
fi

print "\n更新完成，当前版本：${CURRENT_VERSION}"
print "请关闭正在运行的插件，然后在 Figma 中重新打开。"
show_dialog "品牌插件更新完成" "当前版本：${CURRENT_VERSION}\n\n请关闭正在运行的插件，然后在 Figma 中重新打开。"
