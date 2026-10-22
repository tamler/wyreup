import type { ToolRunContext } from '../types.js';
import { UtilityInputError, type UtilityParams, type UtilityResult } from './common.js';
import { buildingCount, buildingError, buildingN, n, purchaseCeiling, validateBoardFootPieces, validateGutterCandidates } from './building-shared.js';

function fullStripFloor(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0)
    buildingError(`$.result.${field}`, 'Invalid full-strip quantity.');
  const nearest = Math.round(value);
  return buildingCount(
    nearest >= 1 && Math.abs(value - nearest) <= 8 * Number.EPSILON * Math.max(1, Math.abs(value))
      ? nearest
      : Math.floor(value),
    field,
  );
}
const money = (value: number) => Math.round(value * 100) / 100;
const waste = (p: UtilityParams) => 1 + buildingN(p, 'wastePercent') / 100;
const coolingTable = [
  [150, 5000],
  [250, 6000],
  [300, 7000],
  [350, 8000],
  [400, 9000],
  [450, 10000],
  [550, 12000],
  [700, 14000],
  [1000, 18000],
  [1200, 21000],
  [1400, 23000],
  [1500, 24000],
] as const;
type Calculate = (p: UtilityParams, ctx: ToolRunContext) => UtilityResult | Promise<UtilityResult>;

const calculations: Record<string, Calculate> = {
  "paint-calculator": (p) => {
    const gross = 2 * (n(p, 'lengthM') + n(p, 'widthM')) * n(p, 'heightM');
    if (n(p, 'openingsM2') > gross) buildingError('openingsM2', 'Openings exceed gross wall area.');
    const wallAreaM2 = gross - n(p, 'openingsM2'),
      ceilingAreaM2 = n(p, 'lengthM') * n(p, 'widthM');
    const includedAreaM2 = wallAreaM2 + (p.includeCeiling ? ceilingAreaM2 : 0);
    const paintL = (includedAreaM2 * n(p, 'paintCoats') * waste(p)) / n(p, 'paintCoverageM2PerL'),
      primerL = (includedAreaM2 * n(p, 'primerCoats') * waste(p)) / n(p, 'primerCoverageM2PerL');
    const paintContainers = purchaseCeiling(paintL / n(p, 'containerL'), 'paintContainers'),
      primerContainers = purchaseCeiling(primerL / n(p, 'containerL'), 'primerContainers');
    return {
      wallAreaM2,
      ceilingAreaM2,
      includedAreaM2,
      paintL,
      primerL,
      paintUsGallons: paintL / 3.785411784,
      primerUsGallons: primerL / 3.785411784,
      paintContainers,
      primerContainers,
      purchasedPaintL: paintContainers * n(p, 'containerL'),
      purchasedPrimerL: primerContainers * n(p, 'containerL'),
    };
  },
  "concrete-bag-calculator": (p) => {
    const effectiveBagYieldM3 = p.bagPreset === 'custom' ? n(p, 'bagYieldM3') : 0.0169901079552,
      effectiveBagMassKg = p.bagPreset === 'custom' ? n(p, 'bagMassKg') : 36.2873896;
    const slabVolumeM3 = n(p, 'lengthM') * n(p, 'widthM') * n(p, 'thicknessM'),
      adjustedVolumeM3 = slabVolumeM3 * waste(p),
      bags = purchaseCeiling(adjustedVolumeM3 / effectiveBagYieldM3, 'bags');
    return {
      slabVolumeM3,
      adjustedVolumeM3,
      bags,
      purchasedYieldM3: bags * effectiveBagYieldM3,
      purchasedMassKg: bags * effectiveBagMassKg,
      cost: money(bags * n(p, 'bagPrice')),
      bagPreset: p.bagPreset as string,
      effectiveBagYieldM3,
      effectiveBagMassKg,
    };
  },
  "gravel-calculator": (p) => {
    const volumeM3 = n(p, 'lengthM') * n(p, 'widthM') * n(p, 'depthM') * waste(p),
      massKg = volumeM3 * n(p, 'densityKgM3');
    return {
      volumeM3,
      cubicYards: volumeM3 / 0.764554857984,
      massKg,
      metricTonnes: massKg / 1000,
      usShortTons: massKg / 907.18474,
      cost: money((massKg / 1000) * n(p, 'pricePerMetricTonne')),
    };
  },
  "mulch-calculator": (p) => {
    const volumeM3 = n(p, 'areaM2') * n(p, 'depthM') * waste(p),
      bags = purchaseCeiling(volumeM3 / n(p, 'bagVolumeM3'), 'bags');
    return {
      volumeM3,
      cubicYards: volumeM3 / 0.764554857984,
      bags,
      cost: money(bags * n(p, 'bagPrice')),
    };
  },
  "roof-pitch-rafter-calculator": (p) => {
    if (n(p, 'overhangM') > n(p, 'runM'))
      buildingError('overhangM', 'Overhang must not exceed run.');
    const pitchRatio = n(p, 'riseM') / n(p, 'runM'),
      extendedRunM = n(p, 'runM') + n(p, 'overhangM'),
      extendedRiseM = pitchRatio * extendedRunM,
      rafterLengthM = Math.hypot(extendedRunM, extendedRiseM);
    return {
      pitchRatio,
      risePer12: pitchRatio * 12,
      angleDegrees: (Math.atan2(n(p, 'riseM'), n(p, 'runM')) * 180) / Math.PI,
      extendedRunM,
      extendedRiseM,
      rafterLengthM,
      roofAreaM2: rafterLengthM * n(p, 'ridgeLengthM') * n(p, 'planes'),
    };
  },
  "tile-calculator-with-waste": (p) => {
    const tileAreaM2 = n(p, 'tileWidthM') * n(p, 'tileHeightM'),
      theoreticalTiles = (n(p, 'areaM2') * waste(p)) / tileAreaM2,
      tiles = purchaseCeiling(theoreticalTiles, 'tiles'),
      boxes = purchaseCeiling(tiles / n(p, 'tilesPerBox'), 'boxes');
    return {
      tileAreaM2,
      theoreticalTiles,
      tiles,
      boxes,
      purchasedAreaM2: boxes * n(p, 'tilesPerBox') * tileAreaM2,
      cost: money(boxes * n(p, 'boxPrice')),
    };
  },
  "drywall-sheet-calculator": (p) => {
    const includedAreaM2 = n(p, 'wallAreaM2') + (p.includeCeiling ? n(p, 'ceilingAreaM2') : 0),
      sheets = purchaseCeiling(
        (includedAreaM2 * waste(p)) / (n(p, 'sheetWidthM') * n(p, 'sheetHeightM')),
        'sheets',
      );
    return {
      includedAreaM2,
      sheets,
      screws: buildingCount(sheets * n(p, 'screwsPerSheet'), 'screws'),
      tapeM: includedAreaM2 * n(p, 'tapeMPerM2'),
      compoundKg: includedAreaM2 * n(p, 'compoundKgPerM2'),
    };
  },
  "fence-material-calculator": (p) => {
    if (n(p, 'postDiameterM') > n(p, 'holeDiameterM'))
      buildingError('postDiameterM', 'Post diameter exceeds hole diameter.');
    const length = n(p, 'lengthM'),
      bays = purchaseCeiling(length / n(p, 'maxBayM'), 'bays'),
      posts = buildingCount(length ? bays + 1 : 0, 'posts'),
      pickets = length
        ? purchaseCeiling(
            (length + n(p, 'picketGapM')) / (n(p, 'picketWidthM') + n(p, 'picketGapM')),
            'pickets',
          )
        : 0,
      concretePerHoleM3 =
        (Math.PI / 4) *
        (n(p, 'holeDiameterM') ** 2 - n(p, 'postDiameterM') ** 2) *
        n(p, 'holeDepthM');
    return {
      bays,
      posts,
      actualBayM: bays ? length / bays : 0,
      rails: buildingCount(bays * n(p, 'railsPerBay'), 'rails'),
      pickets,
      concretePerHoleM3,
      concreteM3: posts * concretePerHoleM3,
    };
  },
  "deck-material-calculator": (p) => {
    const length = n(p, 'lengthM'),
      width = n(p, 'widthM'),
      areaM2 = length * width,
      boardRows = areaM2
        ? purchaseCeiling(
            (width + n(p, 'boardGapM')) / (n(p, 'boardWidthM') + n(p, 'boardGapM')),
            'boardRows',
          )
        : 0,
      piecesPerRow = areaM2
        ? purchaseCeiling(length / n(p, 'stockBoardLengthM'), 'piecesPerRow')
        : 0,
      baseBoardPieces = buildingCount(boardRows * piecesPerRow, 'baseBoardPieces'),
      purchasedBoards = purchaseCeiling(baseBoardPieces * waste(p), 'purchasedBoards'),
      joists = areaM2
        ? buildingCount(purchaseCeiling(length / n(p, 'maxJoistSpacingM'), 'joists') + 1, 'joists')
        : 0,
      intersections = buildingCount(boardRows * joists, 'intersections');
    return {
      areaM2,
      boardRows,
      piecesPerRow,
      baseBoardPieces,
      purchasedBoards,
      joists,
      joistLengthM: joists * width,
      intersections,
      fasteners: buildingCount(intersections * n(p, 'fastenersPerIntersection'), 'fasteners'),
      orientation: 'Boards run along length; joists span width.',
    };
  },
  "paver-calculator": (p) => {
    const areaM2 = n(p, 'lengthM') * n(p, 'widthM'),
      theoreticalPavers = (areaM2 * waste(p)) / (n(p, 'paverWidthM') * n(p, 'paverHeightM'));
    return {
      areaM2,
      theoreticalPavers,
      pavers: purchaseCeiling(theoreticalPavers, 'pavers'),
      baseM3: areaM2 * n(p, 'baseDepthM'),
      sandM3: areaM2 * n(p, 'sandDepthM'),
      edgeM: areaM2 ? 2 * (n(p, 'lengthM') + n(p, 'widthM')) : 0,
    };
  },
  "topsoil-calculator": (p) => {
    const volumeM3 = n(p, 'areaM2') * n(p, 'depthM') * waste(p),
      massKg = volumeM3 * n(p, 'densityKgM3'),
      theoreticalBags = volumeM3 / n(p, 'bagVolumeM3');
    return {
      volumeM3,
      massKg,
      metricTonnes: massKg / 1000,
      theoreticalBags,
      bags: purchaseCeiling(theoreticalBags, 'bags'),
    };
  },
  "sod-calculator": (p) => {
    const adjustedAreaM2 = n(p, 'areaM2') * waste(p),
      rolls = purchaseCeiling(adjustedAreaM2 / n(p, 'rollAreaM2'), 'rolls'),
      pallets = purchaseCeiling(rolls / n(p, 'rollsPerPallet'), 'pallets');
    return {
      adjustedAreaM2,
      rolls,
      pallets,
      purchasedPalletAreaM2: pallets * n(p, 'rollsPerPallet') * n(p, 'rollAreaM2'),
    };
  },
  "hvac-btu-calculator": (p) => {
    const area = n(p, 'areaFt2');
    if (p.mode === 'heating')
      return {
        mode: 'heating',
        baseBtuH: null,
        coolingBtuH: null,
        heatingW: area * 0.09290304 * n(p, 'heatingWPerM2'),
      };
    if (area < 100 || area > 1500)
      buildingError('areaFt2', 'Cooling chart supports100 through1500 square feet.');
    const baseBtuH = coolingTable.find(([upper]) => area <= upper)![1],
      shade = p.shade === 'sunny' ? 1.1 : p.shade === 'shaded' ? 0.9 : 1;
    return {
      mode: 'cooling',
      baseBtuH,
      coolingBtuH:
        ((baseBtuH * shade * n(p, 'ceilingFt')) / 8) * n(p, 'climateFactor') +
        600 * Math.max(0, n(p, 'occupants') - 2) +
        (p.kitchen ? 4000 : 0) +
        n(p, 'additionalWindowBtuH'),
      heatingW: null,
    };
  },
  "insulation-calculator": (p) => {
    const adjustedAreaM2 = n(p, 'areaM2') * waste(p),
      packages = purchaseCeiling(adjustedAreaM2 / n(p, 'packageCoverageM2'), 'packages');
    return {
      adjustedAreaM2,
      packages,
      packageKind: p.packageKind as string,
      cost: money(packages * n(p, 'packagePrice')),
    };
  },
  "asphalt-driveway-calculator": (p) => {
    const volumeM3 = n(p, 'lengthM') * n(p, 'widthM') * n(p, 'thicknessM') * waste(p),
      massKg = volumeM3 * n(p, 'densityKgM3'),
      metricTonnes = massKg / 1000;
    return {
      volumeM3,
      massKg,
      metricTonnes,
      loads: purchaseCeiling(metricTonnes / n(p, 'truckCapacityMetricTonnes'), 'loads'),
      cost: money(metricTonnes * n(p, 'pricePerMetricTonne')),
    };
  },
  "roofing-shingle-bundle-calculator": (p) => {
    const adjustedAreaM2 = n(p, 'roofAreaM2') * waste(p),
      bundles = purchaseCeiling(adjustedAreaM2 / n(p, 'bundleCoverageM2'), 'bundles');
    return {
      adjustedAreaM2,
      roofingSquares: adjustedAreaM2 / (100 * 0.09290304),
      bundles,
      underlaymentRolls: purchaseCeiling(
        adjustedAreaM2 / n(p, 'underlaymentRollM2'),
        'underlaymentRolls',
      ),
      nails: buildingCount(bundles * n(p, 'nailsPerBundle'), 'nails'),
      ridgeCaps: purchaseCeiling(n(p, 'ridgeLengthM') / n(p, 'capCoverageM'), 'ridgeCaps'),
    };
  },
  "retaining-wall-block-calculator": (p) => {
    const length = n(p, 'lengthM'),
      height = n(p, 'heightM'),
      active = length > 0 && height > 0,
      columns = active ? purchaseCeiling(length / n(p, 'blockWidthM'), 'columns') : 0,
      courses = active ? purchaseCeiling(height / n(p, 'blockHeightM'), 'courses') : 0,
      baseBlocks = buildingCount(columns * courses, 'baseBlocks'),
      baseCaps = active ? purchaseCeiling(length / n(p, 'capWidthM'), 'baseCaps') : 0,
      frequency = n(p, 'geogridEveryCourses'),
      geogridLayers =
        active && frequency
          ? buildingCount(Math.floor((courses - 1) / frequency), 'geogridLayers')
          : 0;
    return {
      columns,
      courses,
      baseBlocks,
      purchasedBlocks: purchaseCeiling(baseBlocks * waste(p), 'purchasedBlocks'),
      baseCaps,
      purchasedCaps: purchaseCeiling(baseCaps * waste(p), 'purchasedCaps'),
      baseM3: active ? length * n(p, 'baseWidthM') * n(p, 'baseDepthM') : 0,
      drainM3: active ? length * height * n(p, 'drainWidthM') : 0,
      geogridLayers,
      geogridM2: geogridLayers * length * n(p, 'geogridLengthM'),
    };
  },
  "pond-liner-calculator": (p) => {
    const linerLengthM = n(p, 'lengthM') + 2 * n(p, 'maxDepthM') + 2 * n(p, 'edgeOverlapM'),
      linerWidthM = n(p, 'widthM') + 2 * n(p, 'maxDepthM') + 2 * n(p, 'edgeOverlapM'),
      waterVolumeM3 =
        n(p, 'lengthM') * n(p, 'widthM') * n(p, 'maxDepthM') * n(p, 'volumeShapeFactor');
    return {
      linerLengthM,
      linerWidthM,
      linerAreaM2: linerLengthM * linerWidthM,
      waterVolumeM3,
      waterL: waterVolumeM3 * 1000,
    };
  },
  "french-drain-gravel-calculator": (p) => {
    const pipe = n(p, 'pipeOuterDiameterM');
    if (pipe > n(p, 'trenchWidthM') || pipe > n(p, 'trenchDepthM'))
      buildingError('pipeOuterDiameterM', 'Pipe must fit trench width and depth.');
    const trenchM3 = n(p, 'lengthM') * n(p, 'trenchWidthM') * n(p, 'trenchDepthM'),
      pipeDisplacementM3 = Math.PI * (pipe / 2) ** 2 * n(p, 'lengthM'),
      installedGravelM3 = trenchM3 - pipeDisplacementM3;
    return {
      trenchM3,
      pipeDisplacementM3,
      installedGravelM3,
      purchasedGravelM3: installedGravelM3 * waste(p),
      voidStorageM3: installedGravelM3 * n(p, 'gravelPorosity'),
      pipeM: n(p, 'lengthM'),
      fabricM2:
        n(p, 'lengthM') *
        (n(p, 'trenchWidthM') + 2 * n(p, 'trenchDepthM') + n(p, 'fabricOverlapM')),
    };
  },
  "wallpaper-roll-calculator": (p) => {
    const rawHeight = n(p, 'heightM') + 2 * n(p, 'trimEachEndM'),
      repeat = n(p, 'patternRepeatM'),
      cutHeightM = repeat
        ? purchaseCeiling(rawHeight / repeat, 'repeatMultiples') * repeat
        : rawHeight;
    const stripsPerRoll = fullStripFloor(n(p, 'rollLengthM') / cutHeightM, 'stripsPerRoll');
    if (stripsPerRoll === 0) buildingError('rollLengthM', 'No full-height strip fits this roll.');
    const strips = purchaseCeiling(n(p, 'wallPerimeterM') / n(p, 'rollWidthM'), 'strips'),
      baseRolls = purchaseCeiling(strips / stripsPerRoll, 'baseRolls'),
      extraRolls = strips ? n(p, 'extraRolls') : 0;
    return {
      strips,
      cutHeightM,
      stripsPerRoll,
      baseRolls,
      extraRolls,
      rolls: buildingCount(baseRolls + extraRolls, 'rolls'),
    };
  },
  "board-foot-calculator": (p) => {
    const pieces = validateBoardFootPieces(p.pieces).map((piece) => {
      const boardFeet = (piece.thicknessIn * piece.widthIn * piece.lengthFt * piece.quantity) / 12;
      return {
        ...piece,
        boardFeet,
        volumeM3: boardFeet * 0.002359737216,
        cost: money(boardFeet * piece.pricePerBoardFoot),
      };
    });
    return {
      pieces,
      totalBoardFeet: pieces.reduce((sum, row) => sum + row.boardFeet, 0),
      totalVolumeM3: pieces.reduce((sum, row) => sum + row.volumeM3, 0),
      totalCost: money(pieces.reduce((sum, row) => sum + row.boardFeet * row.pricePerBoardFoot, 0)),
    };
  },
  "stair-stringer-calculator": (p) => {
    const rise = n(p, 'totalRiseM'),
      risers = purchaseCeiling(rise / n(p, 'targetRiserM'), 'risers'),
      actualRiserM = risers ? rise / risers : 0,
      treads = buildingCount(Math.max(0, risers - (p.topFloorIsLastTread ? 1 : 0)), 'treads'),
      totalRunM = treads * n(p, 'treadRunM');
    return {
      status: !rise ? 'empty' : !treads ? 'vertical-rise-no-treads' : 'layout',
      risers,
      actualRiserM,
      treads,
      totalRunM,
      diagonalM: Math.hypot(rise, totalRunM),
      angleDegrees: rise ? (Math.atan2(rise, totalRunM) * 180) / Math.PI : 0,
    };
  },
  "stud-wall-calculator": (p) => {
    const length = n(p, 'lengthM'),
      regularStuds = length
        ? buildingCount(
            purchaseCeiling(length / n(p, 'maxStudSpacingM'), 'regularStuds') + 1,
            'regularStuds',
          )
        : 0,
      totalStuds = length ? buildingCount(regularStuds + n(p, 'extraStuds'), 'totalStuds') : 0,
      actualIntervalM = regularStuds ? length / (regularStuds - 1) : 0;
    if (length && n(p, 'blockingRows') && actualIntervalM <= n(p, 'studThicknessM'))
      buildingError('studThicknessM', 'Blocking requires actual bay clearance.');
    return {
      regularStuds,
      totalStuds,
      actualIntervalM,
      studLengthM: totalStuds * n(p, 'heightM'),
      plateLengthM: length * n(p, 'plateLayers'),
      blockingLengthM: length
        ? n(p, 'blockingRows') * (regularStuds - 1) * (actualIntervalM - n(p, 'studThicknessM'))
        : 0,
    };
  },
  "pipe-volume-calculator": (p) => {
    const volumeM3 = Math.PI * (n(p, 'internalDiameterMm') / 2000) ** 2 * n(p, 'lengthM'),
      litres = volumeM3 * 1000;
    return {
      volumeM3,
      litres,
      usGallons: litres / 3.785411784,
      fluidMassKg: volumeM3 * n(p, 'fluidDensityKgM3'),
    };
  },
  "ramp-slope-calculator": (p) => {
    const rise = n(p, 'riseM'),
      horizontalRunM = rise * n(p, 'runPerRise'),
      runs = purchaseCeiling(horizontalRunM / n(p, 'maxRunM'), 'runs'),
      intermediateLandings = Math.max(0, runs - 1);
    return {
      status: rise ? 'layout' : 'empty',
      horizontalRunM,
      slopePercent: 100 / n(p, 'runPerRise'),
      angleDegrees: (Math.atan(1 / n(p, 'runPerRise')) * 180) / Math.PI,
      slopePathM: Math.hypot(rise, horizontalRunM),
      runs,
      intermediateLandings,
      horizontalExtentM: horizontalRunM + intermediateLandings * n(p, 'landingLengthM'),
    };
  },
  "gutter-size-calculator": (p) => {
    const requiredM3S =
        ((n(p, 'projectedRoofAreaM2') * n(p, 'rainMmH')) / 3600000) *
        n(p, 'runoffCoefficient') *
        n(p, 'catchmentFactor') *
        n(p, 'safetyFactor'),
      requiredLS = requiredM3S * 1000,
      candidates = validateGutterCandidates(p.candidates).map((row, index) => {
        const areaM2 = row.widthM * row.waterDepthM,
          capacityLS =
            (1000 / n(p, 'manningN')) *
            areaM2 *
            (areaM2 / (row.widthM + 2 * row.waterDepthM)) ** (2 / 3) *
            Math.sqrt(n(p, 'slope'));
        return { index, name: row.name, areaM2, capacityLS, passes: capacityLS >= requiredLS };
      });
    let selectedIndex: number | null = null;
    for (const row of candidates)
      if (row.passes && (selectedIndex === null || row.areaM2 < candidates[selectedIndex]!.areaM2))
        selectedIndex = row.index;
    return {
      requiredM3S,
      requiredLS,
      downspouts: purchaseCeiling(requiredLS / n(p, 'downspoutCapacityLS'), 'downspouts'),
      candidates,
      selectedIndex,
      status: !candidates.length
        ? 'no-candidates'
        : selectedIndex === null
          ? 'no-capacity-candidate'
          : 'selected',
    };
  },
  "ac-tonnage-calculator": (p) => {
    const loadBtuH =
      n(p, 'areaFt2') * n(p, 'btuHPerFt2') * n(p, 'ceilingFactor') * n(p, 'climateFactor') +
      n(p, 'extraLoadBtuH');
    return { loadBtuH, refrigerationTons: loadBtuH / 12000 };
  },
};

export function calculateBuilding(id: string, p: UtilityParams, ctx: ToolRunContext): UtilityResult | Promise<UtilityResult> {
  if (!Object.hasOwn(calculations, id)) throw new UtilityInputError('$tool', 'unknown', 'Unknown building calculator.');
  return calculations[id]!(p, ctx);
}

