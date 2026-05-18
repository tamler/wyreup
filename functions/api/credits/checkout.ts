// POST /api/credits/checkout
// Creates a Lemon Squeezy checkout URL for one of the 3 credit packs.
// userId is set server-side from the resolved session — never trusted from
// the request body.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { appOrigin } from '../../_lib/env';
import { json, resolveUser, unauthorized } from '../../_lib/auth';

type Pack = 'starter' | 'standard' | 'power';

function variantFor(env: Env, pack: Pack): string | undefined {
  switch (pack) {
    case 'starter':
      return env.LS_VARIANT_STARTER;
    case 'standard':
      return env.LS_VARIANT_STANDARD;
    case 'power':
      return env.LS_VARIANT_POWER;
  }
}

interface CheckoutBody {
  pack?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as CheckoutBody;
  const pack = body.pack;
  if (pack !== 'starter' && pack !== 'standard' && pack !== 'power') {
    return json({ error: 'Unknown pack' }, 400);
  }

  const variantId = variantFor(env, pack);
  if (!variantId) return json({ error: 'Pack not configured' }, 500);
  if (!env.LS_API_KEY || !env.LS_STORE_ID) {
    return json({ error: 'Payments not configured' }, 500);
  }

  const origin = appOrigin(env);

  const lsRes = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LS_API_KEY}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email: user.email,
            custom: { userId: user.id },
          },
          product_options: {
            redirect_url: `${origin}/account?purchase=success`,
          },
        },
        relationships: {
          store: { data: { type: 'stores', id: env.LS_STORE_ID } },
          variant: { data: { type: 'variants', id: variantId } },
        },
      },
    }),
  });

  if (!lsRes.ok) {
    const detail = await lsRes.text().catch(() => '');
    console.error('LS checkout error', lsRes.status, detail);
    return json({ error: 'Could not create checkout' }, 502);
  }

  const payload = (await lsRes.json()) as {
    data?: { attributes?: { url?: string } };
  };
  const checkoutUrl = payload.data?.attributes?.url;
  if (!checkoutUrl) return json({ error: 'Missing checkout URL' }, 502);

  return json({ checkoutUrl });
};
