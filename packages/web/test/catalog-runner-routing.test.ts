import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { defaultTools } from '@wyreup/core';
import { VARIANT_MAP } from '../src/components/runners/variantMap';

const expectedGroups: Record<string, string[]> = {
  FinanceRunner:
    'tip-calculator discount-calculator sales-tax-calculator loan-calculator mortgage-calculator paypal-fee-calculator stripe-fee-calculator square-fee-calculator amazon-fba-profit-calculator etsy-fee-profit-calculator ebay-fee-profit-calculator fuel-trip-cost-calculator airbnb-host-payout-calculator shopify-profit-margin-calculator ev-charging-cost-calculator youtube-rpm-calculator patreon-earnings-calculator fiverr-fee-calculator upwork-fee-calculator kdp-royalty-calculator tiktok-shop-fee-calculator poshmark-fee-calculator depop-fee-calculator mercari-profit-calculator stockx-seller-fee-calculator shopify-break-even-roas-calculator twitch-subscription-revenue-calculator twitch-bits-to-usd-converter gumroad-fee-calculator kickstarter-fee-calculator printify-profit-calculator redbubble-profit-calculator teespring-profit-calculator amazon-handmade-fee-calculator grailed-fee-calculator reverb-fee-calculator discogs-fee-calculator whatnot-seller-fee-calculator ko-fi-fee-calculator fourthwall-profit-calculator recipe-cost-calculator'.split(
      ' ',
    ),
  UtilityRunner:
    'bmi-calculator age-calculator time-zone-converter random-number-generator dice-roller coin-flip calorie-calculator pool-volume-calculator aquarium-volume-calculator coffee-ratio-calculator rice-water-ratio-calculator turkey-thaw-time-calculator meat-cooking-time-calculator pizza-dough-calculator sourdough-calculator bread-hydration-calculator cake-pan-size-converter yeast-converter sewing-fabric-yardage-calculator shipping-dimensional-weight-calculator pallet-loading-calculator propane-usage-calculator number-to-words-converter chmod-calculator utm-link-builder px-to-rem-converter aspect-ratio-calculator domain-age-checker paint-calculator concrete-bag-calculator gravel-calculator mulch-calculator roof-pitch-rafter-calculator tile-calculator-with-waste drywall-sheet-calculator fence-material-calculator deck-material-calculator paver-calculator topsoil-calculator sod-calculator hvac-btu-calculator insulation-calculator asphalt-driveway-calculator roofing-shingle-bundle-calculator retaining-wall-block-calculator pond-liner-calculator french-drain-gravel-calculator wallpaper-roll-calculator stair-stringer-calculator stud-wall-calculator pipe-volume-calculator ramp-slope-calculator ac-tonnage-calculator screen-ppi-calculator ohms-law-calculator voltage-drop-calculator wire-size-calculator battery-runtime-calculator tv-viewing-distance-calculator projector-throw-distance-calculator solar-panel-output-calculator led-resistor-calculator ups-runtime-calculator solar-battery-bank-calculator speaker-box-volume-calculator'.split(
      ' ',
    ),
  PlanningRowsRunner: ['gpa-calculator', 'grade-calculator', 'cocktail-dilution-calculator'],
  PhotographyContractRunner: ['photography-contract-generator'],
  TimerRunner: ['stopwatch', 'countdown-timer'],
  SeatingChartRunner: ['wedding-seating-chart-builder'],
  NamesRunner: [
    'podcast-name-generator',
    'band-name-generator',
    'clan-name-generator',
    'dnd-name-generator',
  ],
  TextInputRunner: [
    'remove-duplicate-lines-online',
    'markdown-table-generator',
    'bulk-meta-description-generator',
    'javascript-minifier',
    'code-beautifier',
  ],
  GeneratorRunner: [
    'robots-txt-generator',
    'csp-header-generator',
    'hreflang-tag-generator',
    'nginx-redirect-generator',
  ],
  GradientPreview: ['css-gradient-generator'],
  PsdPngRunner: ['psd-to-png'],
  CsvViewerRunner: ['csv-viewer'],
  BankStatementRunner: ['bank-statement-to-csv'],
  StlContourRunner: ['stl-to-gcode'],
  MidiPitchRunner: ['mp3-to-midi'],
  BuildingRowsRunner: [
    'board-foot-calculator',
    'gutter-size-calculator',
    'generator-wattage-calculator',
  ],
  ConstructionEstimateRunner: ['construction-estimate-generator'],
  GamepadRunner: ['gamepad-tester'],
  TouchscreenRunner: ['touchscreen-dead-zone-tester'],
  JsonResultRunner: ['camera-shutter-count-checker'],
};
const toolRunnerSource = readFileSync(
  new URL('../src/components/ToolRunner.svelte', import.meta.url),
  'utf8',
);
const script = toolRunnerSource.slice(
  toolRunnerSource.indexOf('>') + 1,
  toolRunnerSource.indexOf('</script>'),
);
const ast = ts.createSourceFile('ToolRunner.ts', script, ts.ScriptTarget.Latest, true);
function declaration(name: string) {
  let found: ts.VariableDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!found) throw new Error(`Actual ToolRunner declaration missing: ${name}`);
  return found;
}

describe('actual catalog runner routing boundaries', () => {
  it('routes the independently specified139 registered additions to their exact runner', () => {
    const ids = Object.values(expectedGroups).flat();
    expect(ids).toHaveLength(139);
    expect(new Set(ids).size).toBe(139);
    const registered = new Set(defaultTools.map((tool) => tool.id));
    for (const [runner, tools] of Object.entries(expectedGroups))
      for (const id of tools) {
        expect(registered.has(id), id).toBe(true);
        expect(VARIANT_MAP[id], id).toBe(runner);
      }
    expect(VARIANT_MAP['dwg-to-pdf']).toBeUndefined();
  });

  it('uses exactly four local automatic live routes and cron Utility without changing manual PRO', () => {
    for (const id of ['word-counter', 'json-formatter', 'json-path', 'markdown-to-html'])
      expect(VARIANT_MAP[id], id).toBe('LiveTextRunner');
    expect(
      Object.entries(VARIANT_MAP)
        .filter(([, runner]) => String(runner) === 'LiveTextRunner')
        .map(([id]) => id)
        .sort(),
    ).toEqual(['json-formatter', 'json-path', 'markdown-to-html', 'word-counter']);
    expect(VARIANT_MAP['cron-from-text']).toBe('UtilityRunner');
    expect(VARIANT_MAP['cron-from-text-pro']).toBe('TextInputRunner');
    expect(VARIANT_MAP['number-base-converter']).toBe('TextInputRunner');
    expect(VARIANT_MAP['csv-json']).toBe('TextResultRunner');
    expect(VARIANT_MAP['base64']).toBe('TextResultRunner');
  });

  it('provides actual callable literal Svelte imports for every required variant including Gradient default', () => {
    const initializer = declaration('variantLoaders').initializer;
    expect(initializer && ts.isObjectLiteralExpression(initializer)).toBe(true);
    if (!initializer || !ts.isObjectLiteralExpression(initializer))
      throw new Error('Actual loader map is not a literal.');
    const loaders = new Map(
      initializer.properties
        .filter(ts.isPropertyAssignment)
        .map((property) => [
          property.name.getText(ast).replace(/^['"]|['"]$/g, ''),
          property.initializer,
        ]),
    );
    expect(loaders.size).toBe(initializer.properties.length);
    const required = new Set([
      ...Object.keys(expectedGroups),
      ...Object.values(VARIANT_MAP),
      'LiveTextRunner',
    ]);
    for (const variant of required) {
      const value = loaders.get(variant);
      expect(value && ts.isArrowFunction(value), variant).toBe(true);
      if (!value || !ts.isArrowFunction(value))
        throw new Error(`Loader is absent/noncallable: ${variant}`);
      expect(ts.isCallExpression(value.body), variant).toBe(true);
      if (!ts.isCallExpression(value.body))
        throw new Error(`Loader is not an actual import: ${variant}`);
      expect(value.body.expression.kind, variant).toBe(ts.SyntaxKind.ImportKeyword);
      const target = value.body.arguments[0];
      expect(target && ts.isStringLiteral(target), variant).toBe(true);
      if (!target || !ts.isStringLiteral(target))
        throw new Error(`Loader import path is not literal: ${variant}`);
      expect(target.text, variant).toBe(`./runners/${variant}.svelte`);
      expect(
        existsSync(new URL(`../src/components/runners/${variant}.svelte`, import.meta.url)),
        variant,
      ).toBe(true);
    }
  });

  it('refuses unknown routing without a SimpleImage fallback and keeps the original-file display', () => {
    const assignment = ast.statements
      .filter(ts.isLabeledStatement)
      .map((statement) => statement.statement)
      .filter(ts.isExpressionStatement)
      .map((statement) => statement.expression)
      .find(
        (expression) =>
          ts.isBinaryExpression(expression) && expression.left.getText(ast) === 'variant',
      );
    expect(assignment && ts.isBinaryExpression(assignment)).toBe(true);
    if (!assignment || !ts.isBinaryExpression(assignment))
      throw new Error('Actual variant selection is missing.');
    expect(ts.isElementAccessExpression(assignment.right)).toBe(true);
    expect(assignment.right.getText(ast)).toBe('VARIANT_MAP[tool.id]');
    expect(toolRunnerSource).toContain('This tool does not have a supported runner.');
    expect(toolRunnerSource).toContain('effectivePreloaded.name');
    expect(toolRunnerSource).toContain('typeof loader');
    expect(VARIANT_MAP['unregistered-original-file-tool']).toBeUndefined();
  });
});
