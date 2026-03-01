export interface Job {
  id: string;       // unique within source+company, e.g. "12345"
  stateKey: string; // globally unique: "greenhouse-airbnb-12345"
  title: string;
  company: string;
  url: string;
  source: string;
  location?: string;
  postedAt?: string;
}
