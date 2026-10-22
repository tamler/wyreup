import type { ToolCategory, ToolModule, ToolRunContext } from '../types.js';
import { cloneUtilityJson, createUtility, UtilityInputError, type UtilityParams } from './common.js';
import { N, W, buildingChoice, buildingError, buildingResult, buildingRows, buildingSpecs, calculateConstructionEstimate, constructionSpecs, cost, validateConstructionEstimate, type ConstructionEstimateResult, type Spec, type ValidatedConstructionEstimate } from './building-shared.js';
export { BUILDING_UNITS, buildingNumber, buildingChoice, buildingRows, buildingN, buildingError, buildingCount, purchaseCeiling, buildingResult, buildingSpecs, buildingUtility, validateBuildingRows, validateBoardFootPieces, validateGutterCandidates, validateConstructionEstimate, calculateConstructionEstimate } from './building-shared.js';
export type { BoardFootPiece, GutterCandidate, ConstructionMaterial, ConstructionLabor, ConstructionEstimateParams, ValidatedConstructionEstimate, ConstructionEstimateResult } from './building-shared.js';

const boolean = (value: boolean): Spec => [value, { type: 'boolean', label: '' }];
const hidden = (spec: Spec, field: string, equals: string): Spec => [
  spec[0],
  { ...spec[1], showWhen: { field, equals } },
];
const P = (value: number, max = 10000) => N(value, 0.000001, max);
const A = (value: number) => N(value, 0, 1000000);
const C = (value: number, min = 0, max = 1000000) => N(value, min, max, true);
function tool(
  id: string,
  name: string,
  description: string,
  specs: Record<string, Spec>,
  assumptions: string[],
  category: ToolCategory = 'building',
  resultLimit?: number,
  units?: Record<string, string>,
): ToolModule<UtilityParams> {
  return createUtility({
    id,
    name,
    description,
    ...buildingSpecs(specs),
    category,
    keywords: id.split('-'),
    calculate: async (p: UtilityParams, ctx: ToolRunContext) => {
      if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Calculation cancelled.');
      const { calculateBuilding } = await import('./building-calculations.js');
      if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Calculation cancelled.');
      const result = await calculateBuilding(id, p, ctx);
      if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Calculation cancelled.');
      return buildingResult(result, assumptions, resultLimit, units);
    },
  });
}

const paint = tool(
  'paint-calculator',
  'Paint Calculator',
  'Estimate separate paint and primer quantities from walls, openings and entered label coverage.',
  {
    lengthM: N(4),
    widthM: N(3),
    heightM: N(2.5),
    openingsM2: A(3),
    includeCeiling: boolean(false),
    paintCoats: C(2, 0, 20),
    primerCoats: C(1, 0, 20),
    paintCoverageM2PerL: P(10),
    primerCoverageM2PerL: P(10),
    wastePercent: W(0),
    containerL: P(5),
  },
  ['Coverage is entered product label coverage; geometry does not predict surface absorption.'],
);
const concrete = tool(
  'concrete-bag-calculator',
  'Concrete Bag Calculator',
  'Calculate slab volume and whole bags using custom yield or a named Quikrete approximation.',
  {
    lengthM: N(3),
    widthM: N(2),
    thicknessM: N(0.1, 0, 10),
    wastePercent: W(0),
    bagPreset: buildingChoice('custom', ['custom', 'quikrete-80lb-1101']),
    bagYieldM3: hidden(P(0.02), 'bagPreset', 'custom'),
    bagMassKg: hidden(P(25), 'bagPreset', 'custom'),
    bagPrice: cost(0),
  },
  [
    'Quikrete 80lb Concrete Mix1101 approximate yield0.60ft³; custom yield/mass are user inputs.',
    'https://www.quikrete.com/pdfs/data_sheet-concrete%20mix%201101.pdf',
  ],
);
const gravel = tool(
  'gravel-calculator',
  'Gravel Calculator',
  'Estimate volume and weight from entered bulk density.',
  {
    lengthM: N(10),
    widthM: N(2),
    depthM: N(0.1, 0, 100),
    densityKgM3: P(1600, 30000),
    wastePercent: W(0),
    pricePerMetricTonne: cost(0),
  },
  ['Entered density describes the chosen loose/compacted state; no quarry density is inferred.'],
);
const mulch = tool(
  'mulch-calculator',
  'Mulch Calculator',
  'Estimate loose mulch volume and whole bags.',
  {
    areaM2: A(10),
    depthM: N(0.05, 0, 10),
    bagVolumeM3: P(0.05),
    wastePercent: W(0),
    bagPrice: cost(0),
  },
  ['Loose supplied volume; settling and plant clearances are not predicted.'],
);
const roof = tool(
  'roof-pitch-rafter-calculator',
  'Roof Pitch and Rafter Calculator',
  'Calculate pitch, an overhang-extended rafter and repeated rectangular roof area.',
  { runM: P(4), riseM: N(3), ridgeLengthM: N(10), planes: C(2, 1, 4), overhangM: N(0) },
  [
    'Identical rectangular planes of the entered ridge length; hip/valley geometry is not modelled. Horizontal overhang follows the entered pitch; gable-end overhang is not included.',
    'No structural member sizing or birdsmouth design.',
  ],
);
const tile = tool(
  'tile-calculator-with-waste',
  'Tile Calculator with Waste',
  'Estimate face-area tile counts and whole boxes.',
  {
    areaM2: A(10),
    tileWidthM: P(0.5),
    tileHeightM: P(0.5),
    wastePercent: W(10),
    tilesPerBox: C(10, 1),
    boxPrice: cost(0),
  },
  ['Face-area estimate; layout and joints are not inferred.'],
);
const drywall = tool(
  'drywall-sheet-calculator',
  'Drywall Sheet Calculator',
  'Estimate sheets, entered fastener count and surface-based finishing material rates.',
  {
    wallAreaM2: A(32),
    ceilingAreaM2: A(12),
    includeCeiling: boolean(true),
    sheetWidthM: P(1.2),
    sheetHeightM: P(2.4),
    wastePercent: W(10),
    screwsPerSheet: C(40),
    tapeMPerM2: N(1, 0, 10000),
    compoundKgPerM2: N(0.5, 0, 30000),
  },
  [
    'Tape/compound rates are entered surface estimates, not seam layouts or fire-rated assembly specifications.',
  ],
);
const fence = tool(
  'fence-material-calculator',
  'Fence Material Calculator',
  'Estimate one straight run, pickets and circular-hole concrete displacement.',
  {
    lengthM: N(10),
    maxBayM: P(2.5),
    railsPerBay: C(3),
    picketWidthM: P(0.1),
    picketGapM: N(0),
    holeDiameterM: P(0.2),
    holeDepthM: N(0.5, 0, 100),
    postDiameterM: P(0.05),
  },
  [
    'One straight run without shared corners/gates; hole dimensions are inputs, not footing recommendations.',
  ],
);
const deck = tool(
  'deck-material-calculator',
  'Deck Material Calculator',
  'Estimate board stock and joists for one explicitly oriented rectangle.',
  {
    lengthM: N(6),
    widthM: N(3),
    boardWidthM: P(0.15),
    boardGapM: N(0),
    stockBoardLengthM: P(3),
    maxJoistSpacingM: P(0.5, 1),
    fastenersPerIntersection: C(2),
    wastePercent: W(10),
  },
  [
    'No span/ledger/structural fastener/splice design. Purchase waste does not increase fastening intersections.',
  ],
);
const paver = tool(
  'paver-calculator',
  'Paver Calculator',
  'Estimate paver face counts, entered base/sand volume and outer edging.',
  {
    lengthM: N(5),
    widthM: N(4),
    paverWidthM: P(0.2),
    paverHeightM: P(0.1),
    baseDepthM: N(0.1, 0, 100),
    sandDepthM: N(0.03, 0, 100),
    wastePercent: W(10),
  },
  ['Waste affects pavers only; joint/layout and engineered base depth are not inferred.'],
);
const topsoil = tool(
  'topsoil-calculator',
  'Topsoil Calculator',
  'Estimate supplied soil volume, entered density and whole bags.',
  {
    areaM2: A(20),
    depthM: N(0.1, 0, 100),
    densityKgM3: P(1200, 30000),
    bagVolumeM3: P(0.04),
    wastePercent: W(0),
  },
  ['Density/moisture and agronomic depth are user assumptions.'],
);
const sod = tool(
  'sod-calculator',
  'Sod Calculator',
  'Calculate loose rolls and separately whole-pallet purchases.',
  { areaM2: A(20), wastePercent: W(10), rollAreaM2: P(2), rollsPerPallet: C(5, 1) },
  ['Product roll area and whole-pallet size are entered assumptions.'],
);
const cool = (spec: Spec) => hidden(spec, 'mode', 'cooling');
const hvac = tool(
  'hvac-btu-calculator',
  'Room HVAC BTU Calculator',
  'Use a bounded room-AC chart or a separate user-entered heating rate.',
  {
    mode: buildingChoice('cooling', ['cooling', 'heating']),
    areaFt2: P(200, 1000000),
    ceilingFt: cool(N(8, 4, 30)),
    shade: cool(buildingChoice('normal', ['normal', 'sunny', 'shaded'])),
    occupants: cool(C(2, 0, 100)),
    kitchen: cool(boolean(false)),
    climateFactor: cool(N(1, 0.25, 4)),
    additionalWindowBtuH: cool(N(0, 0, 1000000)),
    heatingWPerM2: hidden(N(100, 1, 1000), 'mode', 'heating'),
  },
  [
    'EPA room chart at8-foot ceilings with explicit upper-inclusive boundaries. Height/climate factors are user assumptions scaling chart base only, not EPA-certified adjustments or Manual J.',
    'https://www.energystar.gov/most-efficient/me-certified-room-ac/results?is_most_efficient_filter=Most+Efficient',
  ],
);
const insulation = tool(
  'insulation-calculator',
  'Insulation Calculator',
  'Estimate whole packages using entered coverage for the chosen package label.',
  {
    areaM2: A(100),
    wastePercent: W(10),
    packageCoverageM2: P(5),
    packageKind: buildingChoice('batts', ['batts', 'rolls', 'bags']),
    packagePrice: cost(10),
  },
  ['Entered product/thickness coverage, not inferred R-value or fill yield.'],
);
const asphalt = tool(
  'asphalt-driveway-calculator',
  'Asphalt Driveway Calculator',
  'Estimate entered installed-state volume, tonnes and delivery loads.',
  {
    lengthM: N(10),
    widthM: N(3),
    thicknessM: N(0.05, 0, 100),
    densityKgM3: P(2400, 30000),
    wastePercent: W(0),
    truckCapacityMetricTonnes: P(2),
    pricePerMetricTonne: cost(100),
  },
  [
    'Density/thickness are entered state assumptions; material cost uses required tonnes, not full-load delivery pricing.',
  ],
);
const shingles = tool(
  'roofing-shingle-bundle-calculator',
  'Roofing Shingle Bundle Calculator',
  'Estimate bundles, rolls and entered ridge cap coverage.',
  {
    roofAreaM2: A(100),
    wastePercent: W(10),
    bundleCoverageM2: P(3),
    underlaymentRollM2: P(40),
    nailsPerBundle: C(25),
    ridgeLengthM: N(10),
    capCoverageM: P(0.3),
  },
  [
    'Product coverage/fasteners are inputs, not wind-zone or code requirements. Ridge requirement remains independent of area waste.',
  ],
);
const retaining = tool(
  'retaining-wall-block-calculator',
  'Retaining Wall Block Calculator',
  'Estimate course quantities, caps and entered base/drain/grid geometry.',
  {
    lengthM: N(10),
    heightM: N(1),
    blockWidthM: P(0.5),
    blockHeightM: P(0.2),
    capWidthM: P(0.5),
    baseWidthM: P(0.5),
    baseDepthM: N(0.1, 0, 100),
    drainWidthM: N(0.2),
    geogridEveryCourses: C(2, 0, 100),
    geogridLengthM: N(1),
    wastePercent: W(0),
  },
  [
    'Material geometry only; height/spacing/embedment/drainage are not structural adequacy conclusions. Grid excludes top course.',
  ],
);
const pond = tool(
  'pond-liner-calculator',
  'Pond Liner Calculator',
  'Estimate rectangular liner dimensions and a user-adjusted rectangular water volume.',
  {
    lengthM: P(4),
    widthM: P(3),
    maxDepthM: N(1, 0, 100),
    edgeOverlapM: N(0.5, 0, 10),
    volumeShapeFactor: N(1, 0, 1),
  },
  ['Shape factor is an entered approximation; no biological capacity or waterproofing guarantee.'],
);
const french = tool(
  'french-drain-gravel-calculator',
  'French Drain Gravel Calculator',
  'Separate installed gravel/void storage from purchase waste.',
  {
    lengthM: N(10),
    trenchWidthM: P(0.4),
    trenchDepthM: P(0.5, 100),
    pipeOuterDiameterM: P(0.1),
    fabricOverlapM: N(0.2),
    gravelPorosity: N(0.35, 0, 1),
    wastePercent: W(0),
  },
  [
    'No infiltration/outlet-flow model; extra purchased gravel does not increase installed storage.',
  ],
);
const wallpaper = tool(
  'wallpaper-roll-calculator',
  'Wallpaper Roll Calculator',
  'Estimate full-height strips with pattern-repeat rounding.',
  {
    wallPerimeterM: N(10),
    heightM: P(2.5),
    rollWidthM: P(0.5),
    rollLengthM: P(10),
    patternRepeatM: N(0.5),
    trimEachEndM: N(0.1),
    extraRolls: C(0),
  },
  ['Full-height strips do not subtract openings or model half-drop matching.'],
);
const board = tool(
  'board-foot-calculator',
  'Board Foot Calculator',
  'Calculate actual-dimension board feet and per-row prices.',
  {
    pieces: buildingRows([
      { thicknessIn: 1, widthIn: 12, lengthFt: 8, quantity: 2, pricePerBoardFoot: 3 },
    ]),
  },
  [
    'Actual dimensions, not nominal finished-lumber labels;144 cubic inches per board foot.',
    'Row display costs are rounded per row; totalCost is rounded once from unrounded row costs, so displayed rows may not sum to totalCost.',
  ],
  'building',
  undefined,
  {
    boardFeet: 'board feet (144 cubic inches each)',
    volumeM3: 'cubic metres',
    pricePerBoardFoot: 'entered currency units per board foot',
    cost: 'entered currency units; row display costs rounded per row',
    totalCost: 'entered currency units; rounded once from unrounded row costs',
  },
);
const stair = tool(
  'stair-stringer-calculator',
  'Stair Stringer Calculator',
  'Calculate finite riser/tread layout from entered target geometry.',
  {
    totalRiseM: N(2.8),
    targetRiserM: P(0.175, 1),
    treadRunM: P(0.28),
    topFloorIsLastTread: boolean(true),
  },
  ['Boundary geometry is not a usable-stair/code-compliance or stringer-strength claim.'],
);
const stud = tool(
  'stud-wall-calculator',
  'Stud Wall Calculator',
  'Estimate regular/extra studs, plates and actual-bay blocking.',
  {
    lengthM: N(4),
    heightM: P(2.4),
    maxStudSpacingM: P(0.4),
    studThicknessM: P(0.038),
    plateLayers: C(3),
    blockingRows: C(1),
    extraStuds: C(0),
  },
  ['Entered extra studs are allowances, not header/corner or bearing-wall design.'],
);
const pipe = tool(
  'pipe-volume-calculator',
  'Pipe Volume Calculator',
  'Calculate internal cylinder volume and entered fluid density mass.',
  { internalDiameterMm: N(100), lengthM: N(10), fluidDensityKgM3: N(1000, 0, 30000) },
  ['Internal diameter, not nominal pipe size; no pressure capacity.'],
);
const ramp = tool(
  'ramp-slope-calculator',
  'Ramp Slope Calculator',
  'Calculate geometric run segmentation from entered design slope and landing length.',
  { riseM: N(0.6), runPerRise: N(12, 0.1, 1000), maxRunM: P(3), landingLengthM: N(1.5, 0, 100) },
  [
    'Entered design ratio stays defined for zero-rise empty layout. Segmentation does not establish ADA/local-code compliance or required landing width.',
  ],
);
const gutter = tool(
  'gutter-size-calculator',
  'Rectangular Gutter Size Calculator',
  'Compare entered rectangular flowing-water sections using Manning uniform-flow capacity.',
  {
    projectedRoofAreaM2: A(100),
    rainMmH: N(100, 0, 1000),
    runoffCoefficient: N(1, 0, 1),
    catchmentFactor: N(1, 0.1, 5),
    safetyFactor: N(1, 1, 5),
    downspoutCapacityLS: P(1),
    manningN: N(0.02, 0.008, 0.2),
    slope: N(0.01, 0.0001, 0.2),
    candidates: buildingRows([
      { name: 'small rectangle', widthM: 0.1, waterDepthM: 0.05 },
      { name: 'large rectangle', widthM: 0.2, waterDepthM: 0.1 },
    ]),
  },
  [
    'Steady uniform open rectangular flow only; flowing depth is not full height/freeboard. Projected area stays horizontal. Outlet/blockage/return-period/code constraints are not modelled.',
    'https://www.fhwa.dot.gov/engineering/hydraulics/pubs/08090/HDS4_608.pdf',
  ],
);
const ac = tool(
  'ac-tonnage-calculator',
  'AC Tonnage Calculator',
  'Estimate refrigeration tons using an explicit user-entered area/load rate.',
  {
    areaFt2: A(1000),
    btuHPerFt2: N(20, 1, 1000),
    ceilingFactor: N(1, 0.25, 4),
    climateFactor: N(1, 0.25, 4),
    extraLoadBtuH: N(0, 0, 100000000),
  },
  [
    'Entered rate/factors are examples, not a regional table or whole-building Manual J calculation.',
  ],
);
async function constructionPdf(
  p: ValidatedConstructionEstimate,
  result: ConstructionEstimateResult,
  ctx: ToolRunContext,
): Promise<Blob> {
  const { PDFDocument, StandardFonts, PDFHexString } = await import('@cantoo/pdf-lib');
  if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'PDF cancelled.');
  const pdf = await PDFDocument.create({ updateMetadata: false }),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  const metadataDate = new Date(`${result.pdfMetadataDate}T00:00:00Z`);
  pdf.setCreationDate(metadataDate);
  pdf.setModificationDate(metadataDate);
  pdf.setTitle(p.title);
  pdf.setAuthor('Wyreup');
  const bytes = new TextEncoder().encode(JSON.stringify(p)),
    digest = await crypto.subtle.digest('SHA-256', bytes),
    hex = Array.from(new Uint8Array(digest).slice(0, 16), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  pdf.context.trailerInfo.ID = pdf.context.obj([PDFHexString.of(hex), PDFHexString.of(hex)]);
  const lineTotal = (minorUnits: number): string => {
    const value = BigInt(minorUnits);
    return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
  };
  const rows = [
    ...p.materials.map(
      (row, i) =>
        `Material ${i + 1}: ${row.description} | ${row.quantity} ${row.unit} @ ${row.unitPrice} | ${lineTotal((result.materials as unknown as { lineMinor: number }[])[i]!.lineMinor)}`,
    ),
    ...p.labor.map(
      (row, i) =>
        `Labor ${i + 1}: ${row.description} | ${row.hours} hours @ ${row.hourlyRate} | ${lineTotal((result.labor as unknown as { lineMinor: number }[])[i]!.lineMinor)}`,
    ),
  ];
  const text = [
    p.title,
    `Customer: ${p.customer}`,
    `Currency: ${p.currency} (hundredths) | Issue date: ${p.issueDate || 'not entered'}`,
    ...rows,
    ...Object.entries(result.formattedTotals as Record<string, string>).map(
      ([key, value]) => `${key}: ${value}`,
    ),
    p.notes,
    ...(result.assumptions as string[]),
  ];
  const supportedCharacters = new Set(font.getCharacterSet());
  for (const part of text) {
    for (const character of part) {
      if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'PDF cancelled.');
      if (
        character !== '\n' &&
        character !== '\r' &&
        !supportedCharacters.has(character.codePointAt(0)!)
      )
        throw new UtilityInputError(
          'text',
          'bounds',
          'PDF standard font cannot represent some characters. Use JSON or WinAnsi text.',
        );
    }
  }
  const titleLines = p.title.split(/\r\n|\r|\n/),
    suffix = ` | ${p.currency} | Line items / totals`;
  const continuationWidth = (value: string) =>
    Math.max(
      font.widthOfTextAtSize(value, 10),
      Array.from(value).reduce(
        (width, character) => width + font.widthOfTextAtSize(character, 10),
        0,
      ),
    );
  let continuation = titleLines[0]! + suffix;
  if (titleLines.length > 1 || continuationWidth(continuation) > 510) {
    const characters = Array.from(titleLines[0]!);
    let prefix = '';
    if (titleLines[0]!.trim()) {
      for (const character of characters) {
        if (continuationWidth(prefix + character + '...' + suffix) > 510) break;
        prefix += character;
      }
    }
    continuation = prefix + '...' + suffix;
  }
  let page = pdf.addPage([595.28, 841.89]),
    y = 790;
  const draw = (line: string) => {
    if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'PDF cancelled.');
    if (y < 45) {
      if (pdf.getPageCount() >= 64)
        buildingError('$.result.pages', 'PDF exceeds64 pages.', 'budget');
      page = pdf.addPage([595.28, 841.89]);
      y = 790;
      page.drawText(continuation, {
        x: 40,
        y,
        font,
        size: 10,
        lineHeight: 15,
      });
      y -= 20;
    }
    page.drawText(line, { x: 40, y, font, size: 10 });
    y -= 15;
  };
  for (const part of text) {
    for (const paragraph of part.split(/\r\n|\r|\n/)) {
      let line = '';
      for (const char of paragraph) {
        if (font.widthOfTextAtSize(line + char, 10) > 510) {
          draw(line);
          line = '';
        }
        line += char;
      }
      draw(line);
    }
  }
  const output = await pdf.save({ useObjectStreams: false });
  if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'PDF cancelled.');
  if (output.byteLength > 8 * 1024 * 1024)
    buildingError('$.result.pdf', 'PDF exceeds8MiB.', 'budget');
  return new Blob([Uint8Array.from(output).buffer], { type: 'application/pdf' });
}
export const constructionEstimateGenerator: ToolModule<UtilityParams> = {
  id: 'construction-estimate-generator',
  slug: 'construction-estimate-generator',
  name: 'Construction Estimate Generator',
  description:
    'Create a local line-item estimate in JSON or a paginated PDF. Explicit hundredths and editable rates; no tax/compliance inference.',
  category: 'building',
  keywords: ['construction', 'estimate', 'pdf', 'materials', 'labor'],
  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'application/*', multiple: false },
  ...constructionSpecs,
  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  surfaces: ['web', 'cli', 'mcp'],
  chainSuggestions: [],
  async run(inputs, params, ctx) {
    if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Estimate cancelled.');
    if (inputs.length)
      throw new UtilityInputError('$input', 'bounds', 'This generator does not accept files.');
    const p = validateConstructionEstimate(params),
      result = calculateConstructionEstimate(p);
    let output: Blob;
    if (p.format === 'pdf') output = await constructionPdf(p, result, ctx);
    else
      output = new Blob([JSON.stringify(cloneUtilityJson(result, '$result'))], {
        type: 'application/json',
      });
    if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Estimate cancelled.');
    ctx.onProgress({ stage: 'done', percent: 100 });
    return [output];
  },
  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json', 'application/pdf'],
  },
};
export const buildingTools: ToolModule<UtilityParams>[] = [
  paint,
  concrete,
  gravel,
  mulch,
  roof,
  tile,
  drywall,
  fence,
  deck,
  paver,
  topsoil,
  sod,
  hvac,
  insulation,
  asphalt,
  shingles,
  retaining,
  pond,
  french,
  wallpaper,
  board,
  stair,
  stud,
  pipe,
  ramp,
  gutter,
  ac,
  constructionEstimateGenerator,
];
