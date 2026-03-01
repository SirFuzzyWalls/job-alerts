import fs from "fs";
import path from "path";
import type { CompanyConfig } from "./config.js";

export type BoardEntry = CompanyConfig & { id: string; name: string };
export type BoardsRegistry = BoardEntry[];

export function loadRegistry(): BoardsRegistry {
  const boardsPath = path.resolve(process.cwd(), "boards.json");

  if (!fs.existsSync(boardsPath)) {
    console.warn(
      "Warning: boards.json not found — community registry unavailable. Only inline company objects will work."
    );
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(boardsPath, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to parse boards.json: ${err}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("boards.json must be a JSON array");
  }

  const registry: BoardsRegistry = [];
  for (const entry of parsed) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.id !== "string" ||
      !entry.id ||
      typeof entry.source !== "string" ||
      !entry.source
    ) {
      throw new Error(
        `boards.json: every entry must have non-empty "id" and "source" fields. Invalid entry: ${JSON.stringify(entry)}`
      );
    }
    registry.push(entry as BoardEntry);
  }

  return registry;
}

export function resolveCompanyEntry(
  entry: string | CompanyConfig,
  registry: BoardsRegistry
): CompanyConfig {
  if (typeof entry !== "string") {
    return entry;
  }

  const found = registry.find((b) => b.id === entry);
  if (!found) {
    throw new Error(
      `Unknown company ID "${entry}" — not found in boards.json. ` +
        `Add it to boards.json or use an inline object in config.json.`
    );
  }

  const { id: _id, name: _name, ...companyConfig } = found;
  return companyConfig as CompanyConfig;
}
