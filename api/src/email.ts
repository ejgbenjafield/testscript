import { config } from './config';

/** Sends a transactional email through SendGrid. Returns false when email isn't set up. */
export async function sendEmail(to: string, subject: string, text: string, html: string): Promise<boolean> {
  if (!config.sendgridApiKey || config.isTest) return false;
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.sendgridApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: config.emailFrom, name: 'TestScript' },
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
      }),
    });
    if (!res.ok) console.error('[email] SendGrid rejected the message', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('[email] send failed', err);
    return false;
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
