import fs from "node:fs";
import path from "node:path";

export type BatchCasePolicyViolation = {
  code: string;
  file: string;
  excerpt: string;
  caseNos: string[];
};

const caseNoPattern = /\b(?:DEMO-)?[A-Z]+-\d{2,3}\b/gi;
const actionPattern = /(browser_|page\.|click|fill|select|press|evaluate|執行|儲存|新增|刪除|選擇|輸入|result|xlsx|PASS|FAIL|BLOCKED)/i;

const compact = (value: string): string => value.replace(/\s+/g, " ").trim();

const uniqueCaseNos = (value: string): string[] => {
  const matches = value.match(caseNoPattern) ?? [];
  return [...new Set(matches.map((item) => item.toUpperCase()))];
};

const findSessionFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSessionFiles(entryPath));
    } else if (entry.isFile() && entry.name === "session.md") {
      results.push(entryPath);
    }
  }
  return results;
};

const extractPlaywrightBlocks = (content: string): string[] => {
  const blocks: string[] = [];
  const codeBlockRegex = /### Ran Playwright code[\s\S]*?```(?:js|javascript)?\n([\s\S]*?)```/g;
  for (const match of content.matchAll(codeBlockRegex)) {
    blocks.push(match[1] ?? "");
  }

  const toolCallRegex = /Browser (?:run code|click|type|select option|press key|handle dialog)[\s\S]*?(?=\nBrowser |\n### |\nCalled \d+ tools|$)/gi;
  for (const match of content.matchAll(toolCallRegex)) {
    blocks.push(match[0] ?? "");
  }
  return blocks;
};

export const scanBatchCasePolicyViolations = (runDir: string): BatchCasePolicyViolation[] => {
  const violations: BatchCasePolicyViolation[] = [];
  for (const filePath of findSessionFiles(path.join(runDir, "mcp-output"))) {
    const content = fs.readFileSync(filePath, "utf8");
    const blocks = extractPlaywrightBlocks(content);
    for (const block of blocks) {
      const caseNos = uniqueCaseNos(block);
      if (caseNos.length < 2 || !actionPattern.test(block)) continue;
      violations.push({
        code: "POSSIBLE_MULTI_CASE_PLAYWRIGHT_TOOL_CALL",
        file: filePath,
        excerpt: compact(block).slice(0, 800),
        caseNos
      });
    }
  }
  return violations;
};
