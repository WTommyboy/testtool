export type PostResultExitPolicyInput = {
  exitCode: number | null;
  signal?: string | null;
  usedCodexGeneratedResult: boolean;
  resultXlsxUploaded: boolean;
  runtimeFailureContained?: boolean;
  noResultContained?: boolean;
};

export type PostResultExitPolicy = {
  shouldThrow: boolean;
  reason:
    | "codex_exit_ok"
    | "runtime_failure_contained"
    | "no_result_contained"
    | "trusted_result_uploaded_after_nonzero_exit"
    | "codex_failed_without_trusted_uploaded_result";
  warning?: string;
};

export const evaluatePostResultExitPolicy = (input: PostResultExitPolicyInput): PostResultExitPolicy => {
  if (input.exitCode === 0) {
    return { shouldThrow: false, reason: "codex_exit_ok" };
  }
  if (input.runtimeFailureContained) {
    return { shouldThrow: false, reason: "runtime_failure_contained" };
  }
  if (input.noResultContained) {
    return { shouldThrow: false, reason: "no_result_contained" };
  }
  if (input.usedCodexGeneratedResult && input.resultXlsxUploaded) {
    const exitText = `exit=${input.exitCode ?? "null"} signal=${input.signal ?? "none"}`;
    return {
      shouldThrow: false,
      reason: "trusted_result_uploaded_after_nonzero_exit",
      warning: `Codex returned ${exitText} after a trusted result.xlsx was uploaded; continuing to the next case.`
    };
  }
  return {
    shouldThrow: true,
    reason: "codex_failed_without_trusted_uploaded_result"
  };
};
