import { json, requireCsrfHeader, resolveUser, unauthorized } from '../../_lib/auth';
import type { Env } from '../../_lib/env';
import { billingConfig, object, paddleFetch, paddleId, safeUrl } from '../../_lib/paddle';
import type { PagesFunction } from '../../_lib/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();
  const csrfError = requireCsrfHeader(request, user);
  if (csrfError) return csrfError;
  const config = await billingConfig(env, request);
  if (!config) return json({ error: 'Payments are temporarily unavailable.' }, 503);

  const customer = await env.DB.prepare(`
    SELECT c.customer_id FROM paddle_customers c
    WHERE c.mode=? AND c.user_id=? AND EXISTS (
      SELECT 1 FROM paddle_settlements p WHERE p.mode=c.mode AND p.user_id=c.user_id
    )
  `).bind(config.mode, user.id).first<{ customer_id: string }>();
  if (!paddleId(customer?.customer_id, 'ctm')) return json({ error: 'Billing account not found' }, 404);

  try {
    const response = await paddleFetch(config, `/customers/${customer.customer_id}/portal-sessions`, 'POST', {});
    const data = object(response.payload.data);
    const url = safeUrl(object(object(data.urls).general).overview, config.portalOrigin);
    if (response.ok && data.customer_id === customer.customer_id && url) return json({ portalUrl: url.href });
  } catch {
    // The provider's response may contain private billing and customer details.
  }
  return json({ error: 'Could not open billing management.' }, 502);
};
