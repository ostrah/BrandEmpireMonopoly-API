export interface CapturedMail {
  to: string;
  subject: string;
  html: string;
}

// Shared capture array populated by the nodemailer mock in tests/setup.ts.
// Cleared in a beforeEach hook — tests should not reset it themselves.
export const mailbox: CapturedMail[] = [];

export const lastMailTo = (to: string): CapturedMail => {
  const mail = [...mailbox].reverse().find((m) => m.to === to);
  if (!mail) {
    throw new Error(
      `No mail sent to ${to}. Mailbox contents: ${JSON.stringify(
        mailbox.map((m) => ({ to: m.to, subject: m.subject }))
      )}`
    );
  }
  return mail;
};

export const extractToken = (html: string): string => {
  const match = /[?&]token=([^&"'\s<]+)/.exec(html);
  if (!match) {
    throw new Error('No token query parameter found in email body');
  }
  return decodeURIComponent(match[1]!);
};
