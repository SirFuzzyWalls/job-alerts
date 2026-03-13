export interface Job {
  id: string;       // unique within source+company, e.g. "12345"
  stateKey: string; // globally unique: "greenhouse-airbnb-12345"
  title: string;
  company: string;
  url: string;
  source: string;
  location?: string;
  postedAt?: string;
  salary?: string;        // human-readable, e.g. "$100K–$150K/yr"
  salaryMin?: number;     // annual equivalent in local currency (for filtering)
  salaryMax?: number;     // annual equivalent in local currency (for filtering)
  qualifications?: string; // e.g. "BS+ • 5+ yrs • Python, AWS, Kubernetes"
}
