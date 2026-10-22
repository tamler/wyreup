// ZeptoMail (Zoho transactional email) client.
// HTTP API — works from Workers/Pages Functions (Zoho Mail's SMTP does not).
// API ref: https://www.zoho.com/zeptomail/help/api/email-api.html

import type { Env } from './env';
import { appOrigin } from './env';

interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(
  env: Env,
  args: SendArgs,
): Promise<{ ok: boolean; status?: number }> {
  if (!env.ZEPTOMAIL_TOKEN || !env.ZEPTOMAIL_SENDER) {
    console.warn('ZeptoMail not configured — skipping email send');
    return { ok: false };
  }

  const senderName = env.ZEPTOMAIL_SENDER_NAME || 'Wyreup';

  // ZeptoMail uses its own Authorization scheme: "Zoho-enczapikey <token>".
  // Token from Zoho store may already include that prefix — accept either.
  const token = env.ZEPTOMAIL_TOKEN.startsWith('Zoho-enczapikey')
    ? env.ZEPTOMAIL_TOKEN
    : `Zoho-enczapikey ${env.ZEPTOMAIL_TOKEN}`;

  const res = await fetch('https://api.zeptomail.com/v1.1/email', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: { address: env.ZEPTOMAIL_SENDER, name: senderName },
      to: [{ email_address: { address: args.to } }],
      subject: args.subject,
      textbody: args.text,
      ...(args.html ? { htmlbody: args.html } : {}),
    }),
  }).catch(() => null);

  if (!res) return { ok: false };

  try {
    await res.body?.cancel();
  } catch {
    // Keep the delivery status when disposal of the unread body fails.
  }

  if (!res.ok) {
    console.error('ZeptoMail error', res.status);
    return { ok: false, status: res.status };
  }
  return { ok: true };
}

// Email templates ---------------------------------------------------------

export function welcomeEmail(rawKey: string, env: Env): { subject: string; text: string } {
  const origin = appOrigin(env);
  return {
    subject: 'Your Wyreup API key',
    text: [
      `Your Wyreup API key:`,
      ``,
      `  ${rawKey}`,
      ``,
      `Save this somewhere safe — we don't store it and can't show it again.`,
      ``,
      `Paste it at ${origin}/account to activate PRO tools.`,
      `If this key is rejected, request another emailed key there and try again.`,
      ``,
      `If you didn't request this, you can ignore this email; the account is`,
      `accessible only with a key. Existing keys are unchanged by this request.`,
    ].join('\n'),
  };
}
