import fs from "node:fs";

export type CaseAdvancePolicySource = {
  label: string;
  filePath: string | null | undefined;
};

export type CaseAdvancePolicy = {
  autoAdvance: boolean;
  reason: string;
  matchedSource: string | null;
  matchedText: string | null;
};

const STOP_PATTERNS: RegExp[] = [
  /Agent\s*不會自動\s*dispatch\s*下一\s*case/i,
  /Agent\s*不會自動派發下一題/i,
  /每次\s*run\s*以\s*`?input\/current-case\.json`?\s*為準/i,
  /跑完輸出結果即停止/i,
  /由工具\/PM\s*重新派發下一題/i,
  /每個\s*case\s*跑完必停/i
];

const readSourceText = (source: CaseAdvancePolicySource): string | null => {
  if (!source.filePath || !fs.existsSync(source.filePath)) return null;
  try {
    return fs.readFileSync(source.filePath, "utf8");
  } catch {
    return null;
  }
};

export const evaluateCaseAdvancePolicy = (sources: CaseAdvancePolicySource[]): CaseAdvancePolicy => {
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source.filePath || seen.has(source.filePath)) continue;
    seen.add(source.filePath);
    const text = readSourceText(source);
    if (!text) continue;
    for (const pattern of STOP_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return {
          autoAdvance: false,
          reason: "startup instruction requires one current-case per Agent run",
          matchedSource: source.label,
          matchedText: match[0]
        };
      }
    }
  }

  return {
    autoAdvance: true,
    reason: "no one-case Agent stop directive found in startup/instruction documents",
    matchedSource: null,
    matchedText: null
  };
};
