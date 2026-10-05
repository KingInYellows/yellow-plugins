# shellcheck shell=bash
# Shared by the gt and gh stubs: replay a stack with real `git rebase --onto`,
# so git's own "already used by worktree" constraint is exercised.
#
# Env: STUB_DIR (logs + state), STUB_STACK (trunk first, then the branches
# bottom to top), STUB_REAL_GIT. A branch's old parent tip is kept in
# $STUB_DIR/base/<branch>. STUB_SKIP=<branch> makes a restack skip that
# branch silently (the gt >= 1.8.4 behaviour).

g() { "$STUB_REAL_GIT" "$@"; }
stub_log() { printf '%s\n' "$*" >>"$STUB_DIR/$STUB_NAME.log"; }
base_file() { printf '%s/base/%s' "$STUB_DIR" "${1//\//__}"; }
parent_of() { awk -v b="$1" '$0==b{print p; exit} {p=$0}' "$STUB_STACK"; }

# owner_of BRANCH: path of the worktree that has BRANCH checked out.
owner_of() {
  g worktree list --porcelain | awk -v ref="refs/heads/$1" '/^worktree /{p=substr($0,10)} $0=="branch " ref{print p; exit}'
}

in_progress() { # in_progress DIR
  local gd
  gd=$(g -C "$1" rev-parse --path-format=absolute --git-dir)
  [ -d "$gd/rebase-merge" ] || [ -d "$gd/rebase-apply" ]
}

# eng_begin START: snapshot every branch, queue START and everything above it.
eng_begin() {
  local b
  : >|"$STUB_DIR/snap"
  tail -n +2 "$STUB_STACK" | while IFS= read -r b; do
    printf '%s %s %s\n' "$b" "$(g rev-parse "refs/heads/$b")" "$(cat "$(base_file "$b")")" >>"$STUB_DIR/snap"
  done
  g branch --show-current >|"$STUB_DIR/orig"
  awk -v s="$1" '$0==s{f=1} f' "$STUB_STACK" >|"$STUB_DIR/todo"
}

# eng_run MODE: 0 done, 3 conflict (queue and conflict-* files kept), 1 error.
eng_run() {
  local mode=$1 b parent base ptip where
  while [ -s "$STUB_DIR/todo" ]; do
    b=$(head -n 1 "$STUB_DIR/todo")
    tail -n +2 "$STUB_DIR/todo" >|"$STUB_DIR/todo.new"
    mv -f "$STUB_DIR/todo.new" "$STUB_DIR/todo"
    parent=$(parent_of "$b")
    if [ -n "${STUB_SKIP:-}" ] && [ "$b" = "$STUB_SKIP" ]; then
      echo "Did not restack branch $b because it is checked out in another worktree." >&2
      continue
    fi
    base=$(cat "$(base_file "$b")")
    ptip=$(g rev-parse "refs/heads/$parent")
    [ "$base" != "$ptip" ] || continue
    if [ "$mode" = owner ]; then where=$(owner_of "$b"); else where=$PWD; fi
    if g -C "$where" rebase --onto "refs/heads/$parent" "$base" "$b" >|"$STUB_DIR/rebase.out" 2>&1; then
      g rev-parse "refs/heads/$parent" >|"$(base_file "$b")"
      echo "Restacked $b on $parent." >&2
    else
      cat "$STUB_DIR/rebase.out" >&2
      if in_progress "$where"; then
        printf '%s\n' "$b" >|"$STUB_DIR/conflict-branch"
        printf '%s\n' "$where" >|"$STUB_DIR/conflict-wt"
        return 3
      fi
      return 1
    fi
  done
  rm -f "$STUB_DIR/todo"
  if [ "$mode" = cwd ]; then g checkout -q "$(cat "$STUB_DIR/orig")" || return 1; fi
  return 0
}

# eng_continue MODE: finish the paused rebase, then keep going.
eng_continue() {
  local mode=$1 where b parent
  where=$(cat "$STUB_DIR/conflict-wt")
  [ "$mode" != cwd ] || where=$PWD
  if ! GIT_EDITOR=true g -C "$where" rebase --continue >|"$STUB_DIR/rebase.out" 2>&1; then
    cat "$STUB_DIR/rebase.out" >&2
    if in_progress "$where"; then return 3; fi
    return 1
  fi
  b=$(cat "$STUB_DIR/conflict-branch")
  parent=$(parent_of "$b")
  g rev-parse "refs/heads/$parent" >|"$(base_file "$b")"
  eng_run "$mode"
}

# eng_abort MODE: roll the whole restack back (the snapshot), like gt and gh-stack.
eng_abort() {
  local mode=$1 where b sha base wt
  where=$(cat "$STUB_DIR/conflict-wt")
  [ "$mode" != cwd ] || where=$PWD
  # Fail (nonzero) when the rebase is still in progress afterwards.
  g -C "$where" rebase --abort >/dev/null 2>&1 || ! in_progress "$where" || return 1
  while read -r b sha base; do
    printf '%s\n' "$base" >|"$(base_file "$b")"
    wt=$(owner_of "$b")
    if [ -n "$wt" ]; then g -C "$wt" reset -q --hard "$sha"; elif g show-ref -q --verify "refs/heads/$b"; then g update-ref "refs/heads/$b" "$sha"; fi
  done <"$STUB_DIR/snap"
  if [ "$mode" = cwd ]; then g checkout -q "$(cat "$STUB_DIR/orig")"; fi
  rm -f "$STUB_DIR/todo"
}
