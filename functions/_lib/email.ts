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
  });

  if (!res.ok) {
    console.error('ZeptoMail error', res.status, await res.text().catch(() => ''));
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
      ``,
      `If you didn't request this, you can ignore this email; the account is`,
      `useless without the key.`,
    ].join('\n'),
  };
}

export function existingAccountNoticeEmail(env: Env): { subject: string; text: string } {
  const origin = appOrigin(env);
  return {
    subject: 'Someone tried to create a Wyreup account with this email',
    text: [
      `An account already exists for this email address.`,
      ``,
      `Someone just tried to create another one — we didn't issue a new key.`,
      ``,
      `If this was you, sign in at ${origin}/account using your existing API key`,
      `(or generate a new one from there if you've lost the original).`,
      ``,
      `If it wasn't, no action is needed — your account is untouched.`,
    ].join('\n'),
  };
}
