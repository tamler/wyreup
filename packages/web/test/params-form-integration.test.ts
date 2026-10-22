import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/ParamsFormIntegrationHarness.svelte');
}, 30000);
afterAll(async () => { await harness?.close(); });

function parameters(raw: string | null): object {
  const value: unknown = JSON.parse(raw ?? '{}');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a parameters object');
  }
  return value;
}

function parameter(raw: string | null, key: string): unknown {
  const value = parameters(raw);
  if (!(key in value)) throw new Error(`Missing parameter ${key}`);
  const field: unknown = Reflect.get(value, key);
  return field;
}

it('keeps schema-only secrets masked and exact enum types while refusing an injected option', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    const secret = page.getByLabel('Passphrase', { exact: true });
    await secret.waitFor();
    expect(await secret.getAttribute('type')).toBe('password');
    expect(await secret.inputValue()).toBe('');
    const choice = page.getByLabel('Choice', { exact: true });
    await choice.selectOption({ label: 'Two' });
    const output = page.getByLabel('Current parameters');
    expect(parameters(await output.textContent())).toEqual({ choice: 2, passphrase: '' });
    await choice.evaluate((element) => {
      const select = element as HTMLSelectElement;
      const injected = document.createElement('option');
      injected.value = '999';
      select.append(injected);
      select.value = '999';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(parameters(await output.textContent())).toEqual({ choice: 2, passphrase: '' });
  } finally {
    await page.close();
  }
});

it('keeps equal-looking enum values typed through real DOM selection', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '?scenario=typed');
    const choice = page.getByLabel('Choice', { exact: true });
    const output = page.getByLabel('Current parameters');
    const count = page.getByLabel('Change count');
    for (const [label, value] of [['String one', '1'], ['One', 1], ['Two', 2], ['Empty string', '']] as const) {
      const before = Number(await count.textContent());
      await choice.selectOption({ label });
      const actual = parameter(await output.textContent(), 'choice');
      expect(actual).toBe(value);
      expect(Number(await count.textContent())).toBe(before + 1);
      expect(parameter(await page.getByLabel('Last change').textContent(), 'choice')).toBe(value);
    }
  } finally {
    await page.close();
  }
});

it('replaces an equal-looking dependent enum when only the other type is in its new options', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '?scenario=typed');
    const output = page.getByLabel('Current parameters');
    expect(parameter(await output.textContent(), 'dependent')).toBe(1);
    await page.getByLabel('Category', { exact: true }).selectOption({ label: 'String category' });
    expect(parameter(await output.textContent(), 'dependent')).toBe('1');
    await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Numeric category' });
    expect(parameter(await output.textContent(), 'dependent')).toBe(1);
    expect(await page.getByLabel('Change count').textContent()).toBe('2');
  } finally {
    await page.close();
  }
});

it('refuses noncanonical or out-of-range enum index tokens without emitting a change', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '?scenario=typed');
    const choice = page.getByLabel('Choice', { exact: true });
    await choice.selectOption({ label: 'Two' });
    const before = await page.getByLabel('Current parameters').textContent();
    const count = await page.getByLabel('Change count').textContent();
    for (const token of ['999', '01', '+1', '1.0', '']) {
      await choice.evaluate((element, value) => {
        const select = element as HTMLSelectElement;
        const injected = document.createElement('option');
        injected.value = value;
        injected.textContent = 'Injected token';
        select.append(injected);
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        injected.remove();
      }, token);
      expect(await page.getByLabel('Current parameters').textContent()).toBe(before);
      expect(await page.getByLabel('Change count').textContent()).toBe(count);
    }
  } finally {
    await page.close();
  }
});

for (const invalid of ['1,wrong,2', '1x', '1,,2', 'Infinity']) {
  it(`retains the last complete numeric array and invalid draft for ${JSON.stringify(invalid)}`, async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url + '?scenario=typed');
      const levels = page.getByLabel('Levels', { exact: true });
      const output = page.getByLabel('Current parameters');
      const count = page.getByLabel('Change count');
      await levels.fill(invalid);
      await levels.dispatchEvent('change');
      expect(parameter(await output.textContent(), 'levels')).toEqual([0, 1.5, -2]);
      expect(await count.textContent()).toBe('0');
      expect(await levels.inputValue()).toBe(invalid);
      expect(await levels.getAttribute('aria-invalid')).toBe('true');
      const descriptions = (await levels.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      expect(descriptions.length).toBeGreaterThan(0);
      const feedback = await levels.evaluate((_, ids) => ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' '), descriptions);
      expect(feedback).toMatch(/finite|number|numeric/i);
      await page.getByLabel('Note', { exact: true }).fill('keep invalid draft');
      expect(parameter(await output.textContent(), 'levels')).toEqual([0, 1.5, -2]);
      expect(await count.textContent()).toBe('1');
      expect(await levels.inputValue()).toBe(invalid);
      expect(await levels.getAttribute('aria-invalid')).toBe('true');
      await levels.fill('3, 4.5, -6');
      await levels.dispatchEvent('change');
      expect(parameter(await output.textContent(), 'levels')).toEqual([3, 4.5, -6]);
      expect(await count.textContent()).toBe('2');
      expect(await levels.getAttribute('aria-invalid')).not.toBe('true');
      expect(await levels.evaluate((_, ids) => ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(), descriptions)).toBe('');
      await levels.fill('');
      await levels.dispatchEvent('change');
      expect(parameter(await output.textContent(), 'levels')).toEqual([]);
      expect(await count.textContent()).toBe('3');
    } finally {
      await page.close();
    }
  });
}

it('clears an invalid numeric draft when the parent supplies an external reset', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '?scenario=typed');
    const levels = page.getByLabel('Levels', { exact: true });
    await levels.fill('1x');
    await levels.dispatchEvent('change');
    expect(await levels.getAttribute('aria-invalid')).toBe('true');
    await page.getByRole('button', { name: 'Reset parameters externally', exact: true }).click();
    expect(parameter(await page.getByLabel('Current parameters').textContent(), 'levels')).toEqual([9, 10]);
    expect((await levels.inputValue()).replace(/\s/g, '')).toBe('9,10');
    expect(await levels.getAttribute('aria-invalid')).not.toBe('true');
  } finally {
    await page.close();
  }
});
