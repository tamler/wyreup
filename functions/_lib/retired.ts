export function retiredApiResponse(): Response {
  return new Response(JSON.stringify({ error: 'This API has been retired.' }), {
    status: 410,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
