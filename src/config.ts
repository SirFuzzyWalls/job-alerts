import fs from "fs";
import path from "path";
import { loadRegistry, resolveCompanyEntry } from "./registry.js";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface EmailConfig {
  smtp: SmtpConfig;
  to: string;
  from: string;
}

export interface USAJobsConfig {
  apiKey: string;
  userAgent: string;
}

export type CompanyConfig =
  | { source: "greenhouse"; slug: string }
  | { source: "lever"; slug: string }
  | { source: "ashby"; slug: string }
  | {
      source: "workday";
      company: string;
      careerSite: string;
      subdomain: string;
      baseUrl?: string;  // overrides constructed URL for myworkdaysite.com etc.
    };

export interface Config {
  jobTitles: string[];
  intervalMinutes: number;
  stateRetentionDays: number;
  minSalary?: number;
  maxSalary?: number;
  sendIfNoSalary: boolean;
  locations?: string[];
  sendIfNoLocation: boolean;
  email: EmailConfig;
  usajobs?: USAJobsConfig;
  companies?: CompanyConfig[];
}

interface RawConfig {
  jobTitles: string[];
  intervalMinutes?: number;
  stateRetentionDays?: number;
  minSalary?: number;
  maxSalary?: number;
  sendIfNoSalary?: boolean;
  locations?: string[];
  sendIfNoLocation?: boolean;
  email: EmailConfig;
  usajobs?: USAJobsConfig;
  companies?: "all" | (string | CompanyConfig)[];
  excludeCompanies?: string[];
}

export function loadConfig(): Config {
  const configPath = path.resolve(process.cwd(), "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `config.json not found at ${configPath}. Copy config.example.json to config.json and fill in your settings.`
    );
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse config.json: ${err}`);
  }

  const rawConfig = parsed as RawConfig;

  if (!Array.isArray(rawConfig.jobTitles) || rawConfig.jobTitles.length === 0) {
    throw new Error("config.json: jobTitles must be a non-empty array");
  }
  if (!rawConfig.email?.smtp?.host) {
    throw new Error("config.json: email.smtp.host is required");
  }
  if (!rawConfig.email?.to) {
    throw new Error("config.json: email.to is required");
  }

  const registry = loadRegistry();
  const exclude = new Set(rawConfig.excludeCompanies ?? []);

  let companies: CompanyConfig[];
  if (rawConfig.companies === "all") {
    companies = registry
      .filter((b) => !exclude.has(b.id))
      .map(({ id: _id, name: _name, ...cfg }) => cfg as CompanyConfig);
  } else {
    companies = (rawConfig.companies ?? []).map((entry) =>
      resolveCompanyEntry(entry, registry)
    );
  }

  return {
    ...rawConfig,
    intervalMinutes: rawConfig.intervalMinutes ?? 30,
    stateRetentionDays: rawConfig.stateRetentionDays ?? 90,
    sendIfNoSalary: rawConfig.sendIfNoSalary ?? true,
    sendIfNoLocation: rawConfig.sendIfNoLocation ?? true,
    companies,
  };
}
