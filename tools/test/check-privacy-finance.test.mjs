import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { checkPrivacy } from '../check-privacy.mjs';

const STRIPE = 'https://stripe.com/pricing';
const KDP = [
  'https://kdp.amazon.com/en_US/help/topic/G200634500',
  'https://kdp.amazon.com/en_US/help/topic/GQ8UH9SN83UFNVKR',
];
const INTRO = `Café & "quotes" <estimates> 😀. Official definitions checked 2026-10-11: ${STRIPE}`;
const escapeHtml = (value) => value.replace(/[&<>'"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[c]);
const propsFor = (id, intro) => JSON.stringify({
  tool: [0, { id: [0, id], seoContent: [0, { intro: [0, intro] }] }],
});
const island = (props) => `<astro-island component-url="/_astro/ToolRunner.fixture.js" component-export="default" props="${escapeHtml(props)}"></astro-island>`;
const bodyFor = (props, intro = INTRO) => `${island(props)}<div class="tool-prose"><p>${escapeHtml(intro)}</p></div>`;
const documentFor = (body) => `<!doctype html><html><head><title>Fixture</title></head><body>${body}</body></html>`;

describe('exact passive finance citations', () => {
  let root;
  beforeEach(async () => { root = await mkdtemp('tools/test/.tmp-finance-privacy-'); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  async function scan(body, id = 'stripe-fee-calculator') {
    const dir = `${root}/tools/${id}`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/index.html`, documentFor(body));
    return checkPrivacy({ distDir: root, allowlist: [] });
  }

  it('accepts only the two exact canonical single-citation locations', async () => {
    expect(await scan(bodyFor(propsFor('stripe-fee-calculator', INTRO)))).toEqual({ ok: true, violations: [] });
  });

  it('accepts both ordered KDP citations in each canonical passive location', async () => {
    const intro = `Estimate. Official definitions checked 2026-10-11: ${KDP.join(' ')}`;
    expect(await scan(bodyFor(propsFor('kdp-royalty-calculator', intro), intro), 'kdp-royalty-calculator'))
      .toEqual({ ok: true, violations: [] });
  });

  const active = [
    `<img src="${STRIPE}">`,
    `<script src="${STRIPE}"></script>`,
    `<iframe src="${STRIPE}"></iframe>`,
    `<link rel="stylesheet" href="${STRIPE}">`,
    `<link rel="preload" href="${STRIPE}" as="script">`,
    `<a href="${STRIPE}">Source</a>`,
    `<img srcset="${STRIPE} 1x">`,
    `<div title="${STRIPE}">x</div>`,
    `<img alt="${STRIPE}">`,
    `<meta content="${STRIPE}">`,
    `<div data-other="${STRIPE}">x</div>`,
    `<style>body{background:url(${STRIPE})}</style>`,
    `<script>fetch('${STRIPE}')</script>`,
    `<div style="background:url(${STRIPE})">x</div>`,
    `<button onclick="fetch('${STRIPE}')">x</button>`,
  ];
  it.each(active)('retains an identical active or other-field URL: %s', async (extra) => {
    const result = await scan(bodyFor(propsFor('stripe-fee-calculator', INTRO)) + extra);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].domain).toBe('stripe.com');
  });

  it('does not exempt the same URL in another field of the same props attribute', async () => {
    const props = JSON.parse(propsFor('stripe-fee-calculator', INTRO));
    props.other = [0, STRIPE];
    const result = await scan(bodyFor(JSON.stringify(props)));
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it.each([
    ['wrong page', 'unrelated-tool', bodyFor(propsFor('stripe-fee-calculator', INTRO))],
    ['wrong typed id', 'stripe-fee-calculator', bodyFor(propsFor('other-id', INTRO))],
    ['wrong component', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO)).replace('ToolRunner.fixture', 'Other.fixture')],
    ['duplicate island', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO)) + island(propsFor('stripe-fee-calculator', INTRO))],
    ['duplicate paragraph', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO)).replace('</p>', `</p><p>${escapeHtml(INTRO)}</p>`)],
    ['duplicate attributes', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO)).replace(' props=', ' PROPS="{}" props=')],
    ['duplicate JSON keys', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO).replace('{"tool":', '{"tool":null,"tool":'))],
    ['escaped-equivalent JSON key', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO).replace('{"tool":', '{"\\u0074ool":null,"tool":'))],
    ['noncanonical JSON spacing', 'stripe-fee-calculator', bodyFor(JSON.stringify(JSON.parse(propsFor('stripe-fee-calculator', INTRO)), null, 2))],
    ['malformed JSON', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO).slice(0, -1))],
    ['noncanonical entity', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO)).replaceAll('&quot;', '&#34;')],
    ['malformed entity', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO)).replace('&quot;', '&quo;')],
    ['broken attribute quote', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO)).replace('props="', 'props=""')],
    ['mismatched intro', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO), `Other ${INTRO}`)],
    ['nested paragraph markup', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO)).replace('<p>', '<p><span>').replace('</p>', '</span></p>')],
    ['repaired ancestry', 'stripe-fee-calculator', bodyFor(propsFor('stripe-fee-calculator', INTRO)).replace('<p>', '<p><div>').replace('</p>', '</div></p>')],
    ['active ancestor', 'stripe-fee-calculator', `<a href="/next">${bodyFor(propsFor('stripe-fee-calculator', INTRO))}</a>`],
    ['script marker', 'stripe-fee-calculator', `<script type="text/plain">${bodyFor(propsFor('stripe-fee-calculator', INTRO))}</script>`],
    ['style marker', 'stripe-fee-calculator', `<style>${bodyFor(propsFor('stripe-fee-calculator', INTRO))}</style>`],
    ['template marker', 'stripe-fee-calculator', `<template>${bodyFor(propsFor('stripe-fee-calculator', INTRO))}</template>`],
  ])('refuses %s', async (_name, id, body) => {
    expect((await scan(body, id)).ok).toBe(false);
  });

  it.each([
    `${INTRO}/extra`, `${INTRO}?extra=1`, `${INTRO} trailing`, `${INTRO} ${STRIPE}`,
    INTRO.replace('https:', 'http:'), INTRO.replace('/pricing', '/pricin'),
  ])('refuses an altered complete terminal roster: %s', async (intro) => {
    expect((await scan(bodyFor(propsFor('stripe-fee-calculator', intro), intro))).ok).toBe(false);
  });

  it('refuses reordered, missing or extra multi-source citations', async () => {
    for (const urls of [[...KDP].reverse(), KDP.slice(0, 1), [...KDP, KDP[0]]]) {
      const intro = `Estimate. Official definitions checked 2026-10-11: ${urls.join(' ')}`;
      expect((await scan(bodyFor(propsFor('kdp-royalty-calculator', intro), intro), 'kdp-royalty-calculator')).ok).toBe(false);
    }
  });

  it('refuses ambiguous repeated canonical nested path slices', async () => {
    const props = JSON.parse(propsFor('stripe-fee-calculator', INTRO));
    props.other = props.tool;
    expect((await scan(bodyFor(JSON.stringify(props)))).ok).toBe(false);
  });
});
