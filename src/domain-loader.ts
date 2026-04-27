import fs from "node:fs";
import path from "node:path";

const requiredFiles = ["AGENTS.md", "xlsx_schema.json", "result_parser_adapter.json", "startup_prompt_template.md"] as const;

export type DomainPackSummary = {
  name: string;
  path: string;
  valid: boolean;
  missingFiles: string[];
  displayName: string;
  schemaVersion: string | null;
};

const packsRoot = path.resolve(process.cwd(), "domain-packs");

const safeReadJson = (filePath: string): Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const listDomainPacks = (): DomainPackSummary[] => {
  if (!fs.existsSync(packsRoot)) return [];
  return fs
    .readdirSync(packsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const packPath = path.join(packsRoot, entry.name);
      const missingFiles = requiredFiles.filter((fileName) => !fs.existsSync(path.join(packPath, fileName)));
      const schema = safeReadJson(path.join(packPath, "xlsx_schema.json"));
      return {
        name: entry.name,
        path: packPath,
        valid: missingFiles.length === 0,
        missingFiles,
        displayName: typeof schema.displayName === "string" ? schema.displayName : entry.name,
        schemaVersion: typeof schema.schemaVersion === "string" ? schema.schemaVersion : null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const getDomainPack = (name: string): DomainPackSummary | null => {
  return listDomainPacks().find((pack) => pack.name === name) ?? null;
};

export const readDomainPackFile = (name: string, fileName: typeof requiredFiles[number]): string | null => {
  const pack = getDomainPack(name);
  if (!pack) return null;
  const filePath = path.join(pack.path, fileName);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
};
