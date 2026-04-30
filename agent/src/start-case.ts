import fs from "node:fs";

export type StartCaseHint = {
  caseNo: string;
  source: string;
  excerpt: string;
};

const casePattern = "((?:DEMO-)?[A-Z]+(?:-[A-Z]+)?-\\d{1,3})";

const explicitStartCasePatterns = [
  new RegExp(
    `(?:起始\\s*case|本輪\\s*Codex\\s*起始\\s*case|start\\s*case)\\**\\s*[:：]?\\s*\\**${casePattern}\\**`,
    "i"
  )
];

const startCasePatterns = [
  new RegExp(`(?:start|begin|resume|continue)\\s+(?:from|at|with)?\\s*(?:case\\s*)?${casePattern}`, "i"),
  new RegExp(`(?:從|自|由)\\s*${casePattern}\\s*(?:開始|接續|繼續|往下|起)`, "i"),
  new RegExp(`(?:請|先)?\\s*(?:執行|開始|接續|繼續|跑)\\s*${casePattern}`, "i"),
  new RegExp(`${casePattern}\\s*(?:開始|接續|繼續|起)`, "i")
];

const normalizeCaseNo = (value: string): string => value.trim().replace(/\s+/g, "").toUpperCase();

const compact = (value: string): string => value.replace(/\s+/g, " ").trim();

const excerptAround = (text: string, index: number, length: number): string => {
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + length + 120);
  return compact(text.slice(start, end));
};

const shouldIgnoreGenericStartLine = (line: string): boolean => {
  if (line.includes("|") && /(?:完成\s*case|暫停|確認|繼續)/i.test(line)) return true;
  return /(?:完成\s*case|case\s*completed).{0,80}(?:繼續|continue|resume)/i.test(line);
};

const detectInText = (text: string, source: string): StartCaseHint | null => {
  for (const pattern of explicitStartCasePatterns) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    return {
      caseNo: normalizeCaseNo(match[1]),
      source,
      excerpt: excerptAround(text, match.index, match[0].length)
    };
  }

  let offset = 0;
  for (const line of text.split(/(\r?\n)/)) {
    if (/^\r?\n$/.test(line)) {
      offset += line.length;
      continue;
    }
    if (shouldIgnoreGenericStartLine(line)) {
      offset += line.length;
      continue;
    }
    for (const pattern of startCasePatterns) {
      const match = pattern.exec(line);
      if (!match?.[1]) continue;
      return {
        caseNo: normalizeCaseNo(match[1]),
        source,
        excerpt: excerptAround(text, offset + match.index, match[0].length)
      };
    }
    offset += line.length;
  }
  return null;
};

export const detectStartCaseHint = (inputs: {
  startupInstructionText?: string | null;
  startupInstructionPath?: string | null;
  fallbackMarkdownPath?: string | null;
}): StartCaseHint | null => {
  const sources: Array<{ source: string; text: string }> = [];

  if (inputs.startupInstructionPath && fs.existsSync(inputs.startupInstructionPath)) {
    sources.push({
      source: inputs.startupInstructionPath,
      text: fs.readFileSync(inputs.startupInstructionPath, "utf8")
    });
  }

  if (
    inputs.fallbackMarkdownPath &&
    inputs.fallbackMarkdownPath !== inputs.startupInstructionPath &&
    fs.existsSync(inputs.fallbackMarkdownPath)
  ) {
    sources.push({
      source: inputs.fallbackMarkdownPath,
      text: fs.readFileSync(inputs.fallbackMarkdownPath, "utf8")
    });
  }

  if (inputs.startupInstructionText?.trim()) {
    sources.push({
      source: "task.payload.startup_instruction",
      text: inputs.startupInstructionText
    });
  }

  for (const item of sources) {
    const hint = detectInText(item.text, item.source);
    if (hint) return hint;
  }

  return null;
};
