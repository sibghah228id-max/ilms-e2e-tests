import signupData from "../data/student-signup.json";

/**
 * Disposable inboxes via the mail.tm HTTP API (https://api.mail.tm).
 *
 * Replaces reading OTPs through the yopmail website, which shows a Cloudflare "confirm you're
 * human" challenge to automated browsers and blocks the inbox. Everything here is plain HTTP:
 * no browser, no challenge, and the test can create a fresh inbox per run.
 */

const API_BASE_URL = signupData.mail.apiBaseUrl;

export type Inbox = {
  /** Full email address, e.g. student1234567890123@uberip.com */
  address: string;
  /** Bearer token for reading this inbox. */
  token: string;
};

export type OtpOptions = {
  /** Subject (or part of it) the OTP mail must have. */
  subject?: string | RegExp;
  /** Regex whose first capture group is the OTP. */
  pattern?: RegExp;
  /** How long to keep polling the inbox before giving up. */
  timeoutMs?: number;
  /** Delay between polls. */
  pollMs?: number;
  /** Codes to skip, e.g. an earlier OTP still sitting in the same inbox. */
  ignoreCodes?: string[];
};

type Domain = { domain: string; isActive: boolean };
type MessageSummary = {
  id: string;
  subject: string;
  from: { address: string };
};
type Message = MessageSummary & { text?: string; html?: string[] };
/** mail.tm returns a plain array for `application/json` and a hydra wrapper for `application/ld+json`. */
type Collection<T> = T[] | { "hydra:member": T[] };

const members = <T>(c: Collection<T>): T[] =>
  Array.isArray(c) ? c : (c["hydra:member"] ?? []);

async function api<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      `mail.tm ${init.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * Creates a brand-new inbox on an active mail.tm domain. The local part defaults to a unique
 * `student<timestamp><random>` so every run registers a different email on the portal.
 */
export async function createInbox(localPart?: string): Promise<Inbox> {
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  const name = (localPart ?? `student${Date.now()}${rand}`).toLowerCase();

  const domains = await api<Collection<Domain>>("/domains");
  const domain = members(domains).find((d) => d.isActive)?.domain;
  if (!domain)
    throw new Error("mail.tm reported no active domain to create an inbox on");

  const address = `${name}@${domain}`;
  const password = `Pw-${Date.now()}-${rand}`;

  await api("/accounts", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });
  const { token } = await api<{ token: string }>("/token", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });

  return { address, token };
}

/**
 * Polls the inbox until a mail whose subject matches arrives, then returns the OTP found in it.
 * Prefers the plain-text body; falls back to the HTML body with tags stripped.
 */
export async function fetchOtp(
  inbox: Inbox,
  opts: OtpOptions = {},
): Promise<string> {
  const {
    subject = /OTP/i,
    pattern = /\b(\d{6})\b/,
    timeoutMs = 90_000,
    pollMs = 3_000,
    ignoreCodes = [],
  } = opts;
  const subjectMatches = (s: string) =>
    typeof subject === "string" ? s.includes(subject) : subject.test(s);

  const deadline = Date.now() + timeoutMs;
  let seen = 0;

  while (Date.now() < deadline) {
    const list = await api<Collection<MessageSummary>>(
      "/messages",
      {},
      inbox.token,
    );
    const messages = members(list);
    seen = messages.length;

    // Several OTP mails can share the inbox (signup, then login), so look at every matching mail
    // and skip the codes the caller has already used.
    for (const summary of messages.filter((m) => subjectMatches(m.subject))) {
      const mail = await api<Message>(
        `/messages/${summary.id}`,
        {},
        inbox.token,
      );
      const html = (mail.html ?? []).join("\n").replace(/<[^>]+>/g, " ");
      const candidates = [mail.text ?? "", html, mail.subject];

      const code = candidates
        .map((body) => body.match(pattern)?.[1])
        .find(Boolean);
      if (!code)
        throw new Error(
          `Mail "${mail.subject}" arrived in ${inbox.address} but nothing in it matched ${pattern}`,
        );
      if (!ignoreCodes.includes(code)) return code;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for a mail with subject ${subject} in ${inbox.address} (${seen} other mail(s) seen)`,
  );
}
