# A timeout stub that logs the limit it was given (to $BATS_TEST_TMPDIR/timeout_arg), then times out.
stub_timeout_logging() {
  mkdir -p "${BATS_TEST_TMPDIR}/tobin"
  printf '#!/bin/sh\nprintf "%%s\\n" "$1" >| "%s/timeout_arg"\nexit 124\n' "$BATS_TEST_TMPDIR" >| "${BATS_TEST_TMPDIR}/tobin/timeout"
  chmod +x "${BATS_TEST_TMPDIR}/tobin/timeout"
  export PATH="${BATS_TEST_TMPDIR}/tobin:${PATH}"
}
