#!/usr/bin/env bats
bats_require_minimum_version 1.5.0

# Tests for worktree-manager.sh — focuses on the .ruvector symlink lifecycle
# (create / copy-env / cleanup). Bootstrap a fresh git repo under $BATS_TEST_TMPDIR
# for each test so cases are fully isolated.

setup() {
    SCRIPT="$BATS_TEST_DIRNAME/../scripts/worktree-manager.sh"
    [ -x "$SCRIPT" ] || chmod +x "$SCRIPT"

    REPO="$(mktemp -d)"
    cd "$REPO"
    # `git init -b/--initial-branch` is git>=2.28; the script under test only
    # requires git>=2.5 (--git-common-dir). Use the portable form so the test
    # suite matches the script's documented minimum.
    git init --quiet
    git symbolic-ref HEAD refs/heads/main
    git config user.email test@example.com
    git config user.name "Test"
    printf 'placeholder\n' > README.md
    git add README.md
    git commit --quiet -m "init"
}

teardown() {
    cd /
    rm -rf "$REPO"
}

# Initialize a fake .ruvector/ DB in the main repo.
init_ruvector() {
    mkdir -p "$REPO/.ruvector"
    printf '{"totalMemories":42}\n' > "$REPO/.ruvector/intelligence.json"
}

@test "create: symlink exists and target is main .ruvector (AC-1)" {
    init_ruvector
    run sh "$SCRIPT" create feature-x
    [ "$status" -eq 0 ]
    [ -L "$REPO/.worktrees/feature-x/.ruvector" ]
    [ "$(readlink "$REPO/.worktrees/feature-x/.ruvector")" = "$REPO/.ruvector" ]
}

@test "create: main .ruvector missing — no symlink, warning to stderr (AC-2)" {
    run sh "$SCRIPT" create feature-y
    [ "$status" -eq 0 ]
    # Assert no symlink at all (`-L` would also catch a dangling link, which
    # `-e` would miss because `-e` follows the link target).
    [ ! -L "$REPO/.worktrees/feature-y/.ruvector" ]
    [ ! -e "$REPO/.worktrees/feature-y/.ruvector" ]
    echo "$output" | grep -qi 'main .ruvector/ not found'
}

@test "create: [ -d worktree/.ruvector ] is true via the symlink (AC-3)" {
    init_ruvector
    run sh "$SCRIPT" create feature-z
    [ "$status" -eq 0 ]
    # Hook guards check `[ -d "$RUVECTOR_DIR" ]`; that test must follow the
    # symlink and resolve to the directory.
    [ -d "$REPO/.worktrees/feature-z/.ruvector" ]
}

@test "copy-env: real .ruvector dir already in worktree is preserved (P1-A)" {
    init_ruvector
    # User created the worktree via raw git, then ran ruvector setup from
    # inside it, leaving a real .ruvector/ directory with their isolated DB.
    git worktree add -b feature-iso "$REPO/.worktrees/feature-iso" --quiet
    mkdir -p "$REPO/.worktrees/feature-iso/.ruvector"
    printf '{"isolated":true}\n' > "$REPO/.worktrees/feature-iso/.ruvector/intelligence.json"

    # copy-env should warn and skip — never overwrite the user's isolated DB
    run sh "$SCRIPT" copy-env feature-iso
    [ "$status" -eq 0 ]
    # The directory must still be a real directory, not a symlink
    [ -d "$REPO/.worktrees/feature-iso/.ruvector" ]
    [ ! -L "$REPO/.worktrees/feature-iso/.ruvector" ]
    # The isolated DB content is untouched
    grep -q isolated "$REPO/.worktrees/feature-iso/.ruvector/intelligence.json"
    # The skip-warning fired
    echo "$output" | grep -qi 'isolated DB\|real .ruvector'
}

@test "create: symlink already present is idempotent (P1-D)" {
    init_ruvector
    run sh "$SCRIPT" create feature-idem
    [ "$status" -eq 0 ]
    # Re-running copy-env on the same worktree must not error, must not duplicate
    run sh "$SCRIPT" copy-env feature-idem
    [ "$status" -eq 0 ]
    [ -L "$REPO/.worktrees/feature-idem/.ruvector" ]
    [ "$(readlink "$REPO/.worktrees/feature-idem/.ruvector")" = "$REPO/.ruvector" ]
    # The "already present" info path should have fired
    echo "$output" | grep -qi 'already present'
}

@test "create from inside a worktree: symlink TARGET is MAIN repo, not nested (P0-A)" {
    init_ruvector
    run sh "$SCRIPT" create outer
    [ "$status" -eq 0 ]
    cd "$REPO/.worktrees/outer"
    # When create runs from inside a worktree, get_repo_root() returns the
    # worktree's own root, so the new worktree nests under it. That's not the
    # important property here — what matters is that get_main_repo_root() uses
    # --git-common-dir, so the symlink TARGET is the main repo's .ruvector,
    # NOT the outer worktree's path (which would produce a self-referential
    # dangling link).
    run sh "$SCRIPT" create nested
    [ "$status" -eq 0 ]
    nested_link="$REPO/.worktrees/outer/.worktrees/nested/.ruvector"
    [ -L "$nested_link" ]
    [ "$(readlink "$nested_link")" = "$REPO/.ruvector" ]
}

@test "copy-env: retroactive fix on a pre-existing worktree creates symlink (AC-5)" {
    # Worktree was created before the symlink feature existed: no .ruvector entry
    git worktree add -b legacy "$REPO/.worktrees/legacy" --quiet
    [ ! -e "$REPO/.worktrees/legacy/.ruvector" ]

    init_ruvector
    run sh "$SCRIPT" copy-env legacy
    [ "$status" -eq 0 ]
    [ -L "$REPO/.worktrees/legacy/.ruvector" ]
    [ "$(readlink "$REPO/.worktrees/legacy/.ruvector")" = "$REPO/.ruvector" ]
}

@test "cleanup: symlink removed; main .ruvector/intelligence.json intact (AC-6)" {
    init_ruvector
    run sh "$SCRIPT" create gone-soon
    [ "$status" -eq 0 ]
    [ -L "$REPO/.worktrees/gone-soon/.ruvector" ]

    main_db="$REPO/.ruvector/intelligence.json"
    expected_sum="$(cksum < "$main_db")"

    # cleanup prompts y/N — pipe "y\n"
    run sh -c "printf 'y\n' | sh '$SCRIPT' cleanup"
    [ "$status" -eq 0 ]

    # Worktree directory removed
    [ ! -d "$REPO/.worktrees/gone-soon" ]
    # Main DB byte-identical
    [ -f "$main_db" ]
    [ "$(cksum < "$main_db")" = "$expected_sum" ]
}

@test "copy-env: dangling symlink is removed + main-missing warning fires (F4)" {
    init_ruvector
    run sh "$SCRIPT" create demo
    [ "$status" -eq 0 ]
    [ -L "$REPO/.worktrees/demo/.ruvector" ]

    # Simulate the user deleting the main .ruvector/ — the worktree symlink
    # is now dangling. Re-running copy-env must remove the stale link and
    # warn (not silently report "already present").
    rm -rf "$REPO/.ruvector"
    [ -L "$REPO/.worktrees/demo/.ruvector" ]
    [ ! -e "$REPO/.worktrees/demo/.ruvector" ]   # dangling

    run sh "$SCRIPT" copy-env demo
    [ "$status" -eq 0 ]
    # Repair branch: dangling link removed, no new link (main still gone)
    [ ! -L "$REPO/.worktrees/demo/.ruvector" ]
    [ ! -e "$REPO/.worktrees/demo/.ruvector" ]
    echo "$output" | grep -qi 'dangling'
    echo "$output" | grep -qi 'main .ruvector/ not found'
}

@test "copy-env: dangling symlink + main re-initialized → link repaired (F4 follow-on)" {
    init_ruvector
    run sh "$SCRIPT" create demo
    [ "$status" -eq 0 ]

    # Delete + re-init main with different content
    rm -rf "$REPO/.ruvector"
    mkdir -p "$REPO/.ruvector"
    printf '{"reseeded":true}\n' > "$REPO/.ruvector/intelligence.json"

    # At this point the symlink is technically still pointing at $REPO/.ruvector
    # which now exists with new content — it is no longer dangling. copy-env
    # should report "already present" because the link IS valid (the test
    # below was an over-spec; documenting the actual contract for clarity).
    run sh "$SCRIPT" copy-env demo
    [ "$status" -eq 0 ]
    [ -L "$REPO/.worktrees/demo/.ruvector" ]
    grep -q reseeded "$REPO/.worktrees/demo/.ruvector/intelligence.json"
}

@test "cleanup: pre-fix worktree with no .ruvector entry does not error (P1-E)" {
    # Skip ruvector init — simulate a worktree from before the feature
    git worktree add -b pre-fix "$REPO/.worktrees/pre-fix" --quiet
    [ ! -e "$REPO/.worktrees/pre-fix/.ruvector" ]

    run sh -c "printf 'y\n' | sh '$SCRIPT' cleanup"
    [ "$status" -eq 0 ]
    [ ! -d "$REPO/.worktrees/pre-fix" ]
}
