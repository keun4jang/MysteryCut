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

# 여러 프로젝트(coupang-partners-shop/modeun-motors/trading-bot 등)가 같은
# archive 저장소에 동시에 커밋·푸시한다 — 실측(2026-09-12, 이 훅을 처음 연결한
# 세션)으로 non-fast-forward 거절이 실제로 발생함을 확인했다. 각 프로젝트는
# sessions/<프로젝트명>/ 아래 서로 다른 경로에만 쓰므로 파일 충돌은 사실상
# 없고, 그냥 origin 위로 rebase 후 재푸시하면 된다 — commitPostHistory.mts
# (mysterycut) 와 같은 이유, 다만 여긴 세션별 경로가 원천적으로 겹치지 않아
# 데이터 수준 병합 없이 rebase 만으로 충분하다.
push_with_retry() {
  local max_attempts=5
  local attempt=1
  while (( attempt <= max_attempts )); do
    if git -C "$ARCHIVE_DIR" push -q origin HEAD >> "$LOG" 2>&1; then
      return 0
    fi
    echo "[chat-archive] push 실패 (${attempt}/${max_attempts}) — origin 위로 rebase 후 재시도" >> "$LOG"
    local archive_branch
    archive_branch=$(git -C "$ARCHIVE_DIR" branch --show-current 2>/dev/null)
    if [[ -z "$archive_branch" ]]; then
      echo "[chat-archive] archive 저장소 브랜치 확인 실패 — 재시도 중단" >> "$LOG"
      return 1
    fi
    git -C "$ARCHIVE_DIR" fetch -q origin "$archive_branch" >> "$LOG" 2>&1
    if ! git -C "$ARCHIVE_DIR" rebase -q "origin/$archive_branch" >> "$LOG" 2>&1; then
      # 세션별 경로가 겹치지 않으니 사실상 안 나야 정상이지만, 혹시 나면
      # 로컬 커밋은 그대로 두고(다음 턴에 다시 시도) 여기서 멈춘다 — 자동으로
      # 억지 병합하다 다른 프로젝트의 대화 기록을 깨뜨리는 것보다 낫다.
      git -C "$ARCHIVE_DIR" rebase --abort >> "$LOG" 2>&1
      echo "[chat-archive] rebase 충돌 — 자동 해소 불가(로컬 커밋은 유지, 다음 턴에 재시도됨)" >> "$LOG"
      return 1
    fi
    sleep "$attempt"
    (( attempt++ ))
  done
  return 1
}

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
    if ! push_with_retry; then
      echo "[chat-archive] 저장은 됐지만 업로드(push)에 최종 실패했습니다 — 로그: $LOG" >&2
    fi
  fi
else
  echo "[chat-archive] 대화 변환에 실패했습니다 — 로그: $LOG" >&2
fi

exit 0
