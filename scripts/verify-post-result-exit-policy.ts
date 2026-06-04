import assert from "node:assert/strict";

import { evaluatePostResultExitPolicy } from "../agent/src/post-result-exit-policy";

const ok = evaluatePostResultExitPolicy({
  exitCode: 0,
  usedCodexGeneratedResult: true,
  resultXlsxUploaded: true
});
assert.equal(ok.shouldThrow, false);
assert.equal(ok.reason, "codex_exit_ok");

const contained = evaluatePostResultExitPolicy({
  exitCode: 1,
  usedCodexGeneratedResult: true,
  resultXlsxUploaded: true,
  runtimeFailureContained: true
});
assert.equal(contained.shouldThrow, false);
assert.equal(contained.reason, "runtime_failure_contained");

const trustedUploaded = evaluatePostResultExitPolicy({
  exitCode: 1,
  signal: null,
  usedCodexGeneratedResult: true,
  resultXlsxUploaded: true
});
assert.equal(trustedUploaded.shouldThrow, false);
assert.equal(trustedUploaded.reason, "trusted_result_uploaded_after_nonzero_exit");
assert.match(trustedUploaded.warning ?? "", /trusted result\.xlsx was uploaded/);

const failedWithoutTrustedUpload = evaluatePostResultExitPolicy({
  exitCode: 1,
  usedCodexGeneratedResult: true,
  resultXlsxUploaded: false
});
assert.equal(failedWithoutTrustedUpload.shouldThrow, true);
assert.equal(failedWithoutTrustedUpload.reason, "codex_failed_without_trusted_uploaded_result");

const failedWithFallbackOnly = evaluatePostResultExitPolicy({
  exitCode: 1,
  usedCodexGeneratedResult: false,
  resultXlsxUploaded: true
});
assert.equal(failedWithFallbackOnly.shouldThrow, true);
assert.equal(failedWithFallbackOnly.reason, "codex_failed_without_trusted_uploaded_result");

console.log(JSON.stringify({
  ok: true,
  fixture: "post-result-exit-policy"
}, null, 2));
