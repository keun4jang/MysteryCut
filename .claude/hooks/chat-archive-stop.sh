#!/bin/bash
# Claude Code 대화가 한 턴 끝날 때마다(Stop hook) 대화 기록을
# claude-chat-archive(비공개 저장소)에 자동으로 저장·커밋·푸시한다.
#
# 이 훅은 절대 turn을 막지 않는다(항상 exit 0) — 저장이 실패해도 작업은
# 계속 진행되어야 한다. 실패하면 사장님이 "저장해줘"라고 요청해 수동으로
# 저장할 수 있다 (docs/AGENTS.md 아님, claude-chat-archive/README.md 참고).
#
# 이 스크립트는 archive 저장소 안에서만 git 작업을 한다(git -C 사용, cd 안 함)
# — 그래야 이 저장소(MysteryCut) 작업 트리는 건드리지 않고, 기존
# stop-hook-git-check.sh(미커밋 변경 시 턴을 막는 훅)와 충돌하지 않는다.

input=$(cat)

stop_hook_active=$(echo "$input" | jq -r '.stop_hook_active // "false"' 2>/dev/null)
[[ "$stop_hook_active" == "true" ]] && exit 0

ARCHIVE_DIR="/home/user/claude-chat-archive"
PROJECT="MysteryCut"
LOG="/tmp/chat-archive-last-run.log"

if [[ ! -d "$ARCHIVE_DIR/.git" ]]; then
  echo "[chat-archive] 아카이브 저장소가 이 세션에 연결되어 있지 않아 자동 저장을 건너뜁니다. '저장해줘'라고 요청하면 수동으로 저장할 수 있습니다." >&2
  exit 0
fi

TRANSCRIPT_PATH=$(echo "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
SESSION_ID=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null)

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" || -z "$SESSION_ID" ]]; then
  exit 0
fi

BRANCH=$(git -C "${CWD:-.}" branch --show-current 2>/dev/null)
[[ -z "$BRANCH" ]] && BRANCH="unknown"

if node "$ARCHIVE_DIR/tools/export.mjs" \
    --transcript "$TRANSCRIPT_PATH" \
    --project "$PROJECT" \
    --session-id "$SESSION_ID" \
    --source-repo "keun4jang/${PROJECT}" \
    --source-branch "$BRANCH" \
    --archive-dir "$ARCHIVE_DIR" > "$LOG" 2>&1
then
  if [[ -n "$(git -C "$ARCHIVE_DIR" status --porcelain)" ]]; then
    git -C "$ARCHIVE_DIR" add -A
    git -C "$ARCHIVE_DIR" commit -q \
      -m "chat-archive: ${PROJECT} 자동 저장 (${SESSION_ID:0:8})" \
      -m "Automated by .claude/hooks/chat-archive-stop.sh (Stop hook)"
    if ! git -C "$ARCHIVE_DIR" push -q origin HEAD >> "$LOG" 2>&1; then
      echo "[chat-archive] 저장은 됐지만 업로드(push)에 실패했습니다 — 로그: $LOG" >&2
    fi
  fi
else
  echo "[chat-archive] 대화 변환에 실패했습니다 — 로그: $LOG" >&2
fi

exit 0
