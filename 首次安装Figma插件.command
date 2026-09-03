#!/bin/zsh

set -euo pipefail

INSTALL_DIR="${BRAND_STYLE_PLUGIN_INSTALL_DIR:-${HOME}/BrandStyleFigmaPlugin}"
ARCHIVE_URL="${BRAND_STYLE_PLUGIN_ARCHIVE_URL:-https://github.com/lbeilei9705-png/brand-style/archive/refs/heads/main.zip}"
LOG_FILE="${TMPDIR:-/tmp}/brand-style-plugin-install.log"
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

fail_install() {
  local message="$1"
  print "\n安装失败：${message}"
  print "日志：${LOG_FILE}"
  show_dialog "品牌插件安装失败" "${message}\n\n日志：${LOG_FILE}"
  exit 1
}

print "正在安装品牌 Figma 插件…"
command -v curl >/dev/null 2>&1 || fail_install "没有找到系统下载工具 curl。"

if [[ "${1:-}" == "--check" ]]; then
  print "检查通过：系统下载工具与安装路径可用。"
  exit 0
fi

if [[ -f "$INSTALL_DIR/apps/figma-plugin/manifest.json" ]]; then
  print "检测到已经安装，转为执行更新。"
  [[ -f "$INSTALL_DIR/更新Figma插件.command" ]] \
    || fail_install "现有安装缺少更新工具，请联系维护人员重新获取安装包。"
  chmod +x "$INSTALL_DIR/更新Figma插件.command" 2>/dev/null || true
  "$INSTALL_DIR/更新Figma插件.command"
  exit 0
fi

if [[ -e "$INSTALL_DIR" ]]; then
  fail_install "安装目录已存在但不是有效插件：${INSTALL_DIR}"
fi

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/brand-style-install.XXXXXX")"
print "正在下载最新插件…"
curl --fail --location --retry 2 --connect-timeout 15 --max-time 180 --silent --show-error "$ARCHIVE_URL" -o "$temp_dir/plugin.zip" \
  || fail_install "下载失败，请检查网络或仓库访问权限。"

ditto -x -k "$temp_dir/plugin.zip" "$temp_dir/unpacked" \
  || fail_install "无法解压安装文件。"
unpacked_dirs=("$temp_dir/unpacked"/*(/N))
source_dir="${unpacked_dirs[1]:-}"
[[ -n "$source_dir" && -f "$source_dir/apps/figma-plugin/manifest.json" && -f "$source_dir/apps/figma-plugin/dist/ui.html" ]] \
  || fail_install "下载内容不完整，已停止安装。"

mkdir "$INSTALL_DIR" || fail_install "无法创建安装目录：${INSTALL_DIR}"
ditto "$source_dir" "$INSTALL_DIR" || fail_install "无法写入安装目录。"
chmod +x "$INSTALL_DIR/更新Figma插件.command" 2>/dev/null || true

manifest_path="$INSTALL_DIR/apps/figma-plugin/manifest.json"
[[ "${BRAND_STYLE_PLUGIN_NO_UI:-}" == "1" ]] || open -R "$manifest_path" || true

print "\n安装完成：${INSTALL_DIR}"
print "Finder 已定位 manifest.json。请在 Figma 中只导入这一次。"
show_dialog "品牌插件安装完成" "Finder 已定位 manifest.json。\n\n请在 Figma Desktop 中打开：插件 → 开发 → 从 manifest 导入插件，然后选择该文件。以后更新只需双击“更新Figma插件.command”。"
