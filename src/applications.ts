import fs from "fs";
import path from "path";
import { writeFileAtomic } from "./utils.js";

export type ApplicationStatus = "none" | "interested" | "applied" | "interview" | "offer" | "rejected";

export interface ApplicationEntry {
  status: ApplicationStatus;
  updatedAt: number;
}

const APPLICATIONS_FILE = path.join(process.cwd(), "application_status.json");

let applications: Record<string, ApplicationEntry> = {};
let loaded = false;

export function loadApplications(): Record<string, ApplicationEntry> {
  if (loaded) return applications;
  try {
    if (fs.existsSync(APPLICATIONS_FILE)) {
      const raw = fs.readFileSync(APPLICATIONS_FILE, "utf-8");
      applications = JSON.parse(raw) as Record<string, ApplicationEntry>;
    }
  } catch {
    // ignore corrupt file
  }
  loaded = true;
  return applications;
}

export function getAllApplications(): Record<string, ApplicationEntry> {
  loadApplications();
  return { ...applications };
}

export function setApplication(stateKey: string, status: ApplicationStatus): void {
  loadApplications();
  if (status === "none") {
    delete applications[stateKey];
  } else {
    applications[stateKey] = { status, updatedAt: Date.now() };
  }
  writeFileAtomic(APPLICATIONS_FILE, JSON.stringify(applications, null, 2));
}
