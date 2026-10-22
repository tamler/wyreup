import type { ToolRunContext } from '../types.js';
import { UtilityInputError, type UtilityParams, type UtilityResult } from './common.js';
import { buildingCount, buildingError, buildingN as n, purchaseCeiling } from './building-shared.js';
import { abort, validateGeneratorLoads } from './hardware-shared.js';

const rho = (p: UtilityParams) => (1 / 58) * (1 + 0.00393 * (n(p, 'temperatureC') - 20));
const factor = (p: UtilityParams) => (p.phase === 'three-phase' ? Math.sqrt(3) : 2);
const e12Ticks = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82]
  .flatMap((base) => Array.from({ length: 7 }, (_, d) => base * 10 ** d))
  .concat(100000000)
  .sort((a, b) => a - b);
type Calculate = (p: UtilityParams, ctx: ToolRunContext) => UtilityResult | Promise<UtilityResult>;

const calculations: Record<string, Calculate> = {
  "screen-ppi-calculator": (p) => {
    const pixels = Math.hypot(n(p, 'pixelWidth'), n(p, 'pixelHeight')),
      ppi = pixels / n(p, 'diagonalIn');
    return {
      ppi,
      pixelPitchMm: 25.4 / ppi,
      widthIn: (n(p, 'diagonalIn') * n(p, 'pixelWidth')) / pixels,
      heightIn: (n(p, 'diagonalIn') * n(p, 'pixelHeight')) / pixels,
    };
  },
  "ohms-law-calculator": (p) => {
    const a = n(p, 'first'),
      b = n(p, 'second'),
      pair = p.pair as string;
    let voltageV: number, currentA: number, resistanceOhm: number, powerW: number;
    if (pair === 'VI') {
      if (a <= 0 || b <= 0)
        buildingError(
          'pair',
          'VI requires positive voltage and current for unique positive resistance.',
        );
      voltageV = a;
      currentA = b;
      resistanceOhm = a / b;
      powerW = a * b;
    } else if (pair === 'VR') {
      if (b <= 0) buildingError('second', 'Known resistance must be positive.');
      voltageV = a;
      resistanceOhm = b;
      currentA = a / b;
      powerW = a * currentA;
    } else if (pair === 'IR') {
      if (b <= 0) buildingError('second', 'Known resistance must be positive.');
      currentA = a;
      resistanceOhm = b;
      voltageV = a * b;
      powerW = voltageV * a;
    } else if (pair === 'VP') {
      if (a <= 0 || b <= 0) buildingError('pair', 'VP requires positive voltage and power.');
      voltageV = a;
      powerW = b;
      currentA = b / a;
      resistanceOhm = (a * a) / b;
    } else if (pair === 'IP') {
      if (a <= 0 || b <= 0) buildingError('pair', 'IP requires positive current and power.');
      currentA = a;
      powerW = b;
      voltageV = b / a;
      resistanceOhm = b / (a * a);
    } else {
      if (a <= 0) buildingError('first', 'Known resistance must be positive.');
      resistanceOhm = a;
      powerW = b;
      voltageV = Math.sqrt(a * b);
      currentA = Math.sqrt(b / a);
    }
    return { pair, voltageV, currentA, resistanceOhm, powerW };
  },
  "voltage-drop-calculator": (p) => {
    const resistivityOhmMm2M = rho(p),
      oneWayResistanceOhm = (resistivityOhmMm2M * n(p, 'oneWayLengthM')) / n(p, 'areaMm2'),
      dropV = factor(p) * n(p, 'currentA') * oneWayResistanceOhm,
      insufficient = dropV >= n(p, 'supplyV');
    return {
      phase: p.phase as string,
      resistivityOhmMm2M,
      oneWayResistanceOhm,
      dropV,
      dropPercent: (100 * dropV) / n(p, 'supplyV'),
      loadV: insufficient ? null : n(p, 'supplyV') - dropV,
      lineLossW: (p.phase === 'three-phase' ? 3 : 2) * n(p, 'currentA') ** 2 * oneWayResistanceOhm,
      status: insufficient ? 'insufficient-voltage' : 'sufficient',
    };
  },
  "wire-size-calculator": (p) => {
    const minimumAreaMm2 =
      (factor(p) * rho(p) * n(p, 'oneWayLengthM') * n(p, 'currentA')) /
      ((n(p, 'supplyV') * n(p, 'maxDropPercent')) / 100);
    for (let awg = 36; awg >= -3; awg--) {
      const diameterMm = 0.127 * 92 ** ((36 - awg) / 39),
        selectedAreaMm2 = (Math.PI * diameterMm ** 2) / 4;
      if (selectedAreaMm2 >= minimumAreaMm2) {
        const actualDropV =
          (factor(p) * rho(p) * n(p, 'oneWayLengthM') * n(p, 'currentA')) / selectedAreaMm2;
        return {
          minimumAreaMm2,
          phase: p.phase as string,
          status: 'selected',
          awg,
          label: awg > 0 ? `AWG${awg}` : `${1 - awg}/0`,
          selectedAreaMm2,
          actualDropV,
          actualDropPercent: (100 * actualDropV) / n(p, 'supplyV'),
        };
      }
    }
    return {
      minimumAreaMm2,
      phase: p.phase as string,
      status: 'no-available-candidate',
      awg: null,
      label: null,
      selectedAreaMm2: null,
      actualDropV: null,
      actualDropPercent: null,
    };
  },
  "battery-runtime-calculator": (p) => {
    const nominalWh = n(p, 'voltageV') * n(p, 'capacityAh'),
      usableWh = nominalWh * n(p, 'usableFraction') * n(p, 'efficiency'),
      totalDrawW = n(p, 'loadW') + n(p, 'standbyW');
    if (!totalDrawW) buildingError('loadW', 'Runtime is undefined with zero total draw.');
    return { nominalWh, usableWh, totalDrawW, runtimeHours: usableWh / totalDrawW };
  },
  "tv-viewing-distance-calculator": (p) => {
    const diagonal = Math.hypot(n(p, 'aspectWidth'), n(p, 'aspectHeight')),
      widthIn = (n(p, 'diagonalIn') * n(p, 'aspectWidth')) / diagonal,
      heightIn = (n(p, 'diagonalIn') * n(p, 'aspectHeight')) / diagonal,
      referenceMultiplier = p.resolution === '4k' ? 1.5 : 3;
    return {
      widthIn,
      heightIn,
      referenceMultiplier,
      referenceDistanceIn: heightIn * referenceMultiplier,
      geometricFovDistanceIn: widthIn / (2 * Math.tan((n(p, 'horizontalFovDeg') * Math.PI) / 360)),
      resolution: p.resolution as string,
    };
  },
  "projector-throw-distance-calculator": (p) => {
    if (n(p, 'maxThrowRatio') < n(p, 'minThrowRatio'))
      buildingError('maxThrowRatio', 'Maximum ratio must not be below minimum.');
    const imageHeightM = (n(p, 'imageWidthM') * n(p, 'aspectHeight')) / n(p, 'aspectWidth');
    return {
      imageHeightM,
      imageDiagonalM: Math.hypot(n(p, 'imageWidthM'), imageHeightM),
      minDistanceM: n(p, 'imageWidthM') * n(p, 'minThrowRatio'),
      maxDistanceM: n(p, 'imageWidthM') * n(p, 'maxThrowRatio'),
    };
  },
  "generator-wattage-calculator": (p, ctx) => {
    let rawContinuousW = 0,
      simultaneous = 0,
      maxExtra = 0;
    for (const row of validateGeneratorLoads(p.loads)) {
      abort(ctx.signal);
      rawContinuousW += row.quantity * row.runningW;
      simultaneous += row.quantity * row.startingW;
      if (row.quantity) maxExtra = Math.max(maxExtra, row.startingW - row.runningW);
      if (rawContinuousW > 1e12 || simultaneous > 1e12)
        buildingError('$.result.rawPower', 'Derived power exceeds1e12W.');
    }
    const rawPeakW = p.startupMode === 'simultaneous' ? simultaneous : rawContinuousW + maxExtra,
      margin = 1 + n(p, 'headroomPercent') / 100,
      pf = n(p, 'powerFactor');
    return {
      rawContinuousW,
      rawPeakW,
      rawContinuousVA: rawContinuousW / pf,
      rawPeakVA: rawPeakW / pf,
      headroomContinuousW: rawContinuousW * margin,
      headroomPeakW: rawPeakW * margin,
      headroomContinuousVA: (rawContinuousW * margin) / pf,
      headroomPeakVA: (rawPeakW * margin) / pf,
      startupMode: p.startupMode as string,
    };
  },
  "solar-panel-output-calculator": (p) => {
    const nominalW = n(p, 'panelW') * n(p, 'panelCount'),
      dailyKwh = (nominalW * n(p, 'peakSunHours') * (1 - n(p, 'lossPercent') / 100)) / 1000;
    return { nominalW, dailyKwh, totalKwh: dailyKwh * n(p, 'days'), days: n(p, 'days') };
  },
  "led-resistor-calculator": (p) => {
    const headroomV = n(p, 'supplyV') - n(p, 'ledsInSeries') * n(p, 'forwardV');
    if (headroomV <= 0) buildingError('supplyV', 'Supply must exceed total LED forward voltage.');
    const idealResistanceOhm = headroomV / (n(p, 'targetMa') / 1000);
    let selectedResistanceOhm = idealResistanceOhm;
    if (p.series === 'E12') {
      if (idealResistanceOhm < 1 || idealResistanceOhm > 1e7)
        buildingError('targetMa', 'E12 ideal resistance must be1Ω through10MΩ.');
      const idealTicks = idealResistanceOhm * 10;
      selectedResistanceOhm =
        e12Ticks.find(
          (ticks) =>
            ticks >= idealTicks ||
            Math.abs(ticks - idealTicks) <=
              8 * Number.EPSILON * Math.max(1, Math.abs(ticks), Math.abs(idealTicks)),
        )! / 10;
    } else if (idealResistanceOhm > 1e12)
      buildingError('$.result.idealResistanceOhm', 'Exact resistance exceeds1e12Ω.');
    const actualCurrentPerStringMa = (1000 * headroomV) / selectedResistanceOhm,
      resistorPowerPerStringW = headroomV ** 2 / selectedResistanceOhm,
      minimumPowerRatingPerStringW = n(p, 'powerMargin') * resistorPowerPerStringW,
      selectedPowerRatingPerStringW =
        [0.125, 0.25, 0.5, 1, 2, 5, 10].find((rating) => rating >= minimumPowerRatingPerStringW) ??
        null,
      resistorCount = n(p, 'parallelStrings');
    return {
      headroomV,
      idealResistanceOhm,
      selectedResistanceOhm,
      actualCurrentPerStringMa,
      resistorPowerPerStringW,
      minimumPowerRatingPerStringW,
      selectedPowerRatingPerStringW,
      resistorCount,
      totalCurrentMa: resistorCount * actualCurrentPerStringMa,
      totalResistorPowerW: resistorCount * resistorPowerPerStringW,
      status: selectedPowerRatingPerStringW === null ? 'power-rating-unavailable' : 'estimate',
    };
  },
  "ups-runtime-calculator": (p) => {
    const nominalWh = n(p, 'batteryV') * n(p, 'batteryAh'),
      usableWh = nominalWh * n(p, 'usableFraction') * n(p, 'inverterEfficiency'),
      totalDrawW = n(p, 'loadW') + n(p, 'standbyW');
    if (!totalDrawW) buildingError('loadW', 'Runtime is undefined with zero total draw.');
    const runtimeHours = usableWh / totalDrawW;
    return {
      nominalWh,
      usableWh,
      totalDrawW,
      runtimeHours,
      runtimeMinutes: runtimeHours * 60,
      status: n(p, 'loadW') > n(p, 'ratedOutputW') ? 'overload' : 'within-rating',
    };
  },
  "solar-battery-bank-calculator": (p) => {
    const quotient = n(p, 'bankV') / n(p, 'batteryV'),
      series = Math.round(quotient);
    if (series < 1 || Math.abs(quotient - series) > 1e-6 * Math.max(1, Math.abs(quotient)))
      buildingError(
        'bankV',
        'Bank voltage must be an integral series multiple within relative1e-6.',
      );
    buildingCount(series, 'series');
    const requiredNominalWh =
        (n(p, 'dailyWh') * n(p, 'autonomyDays')) / (n(p, 'usableFraction') * n(p, 'efficiency')),
      requiredAh = requiredNominalWh / n(p, 'bankV'),
      parallel = purchaseCeiling(requiredAh / n(p, 'batteryAh'), 'parallel'),
      totalBatteries = buildingCount(series * parallel, 'totalBatteries'),
      actualSeriesV = series * n(p, 'batteryV'),
      actualNominalWh = actualSeriesV * n(p, 'batteryAh') * parallel;
    return {
      requiredNominalWh,
      requiredAh,
      series,
      parallel,
      totalBatteries,
      actualSeriesV,
      actualNominalWh,
      actualUsableWh: actualNominalWh * n(p, 'usableFraction') * n(p, 'efficiency'),
    };
  },
  "speaker-box-volume-calculator": (p) => {
    const twice = 2 * n(p, 'panelThicknessCm'),
      innerWidthCm = n(p, 'outerWidthCm') - twice,
      innerHeightCm = n(p, 'outerHeightCm') - twice,
      innerDepthCm = n(p, 'outerDepthCm') - twice;
    if (innerWidthCm <= 0 || innerHeightCm <= 0 || innerDepthCm <= 0)
      buildingError(
        'panelThicknessCm',
        'Twice panel thickness must be smaller than each outer dimension.',
      );
    const grossL = (innerWidthCm * innerHeightCm * innerDepthCm) / 1000,
      netL =
        grossL -
        n(p, 'driverDisplacementL') -
        n(p, 'portDisplacementL') -
        n(p, 'braceDisplacementL');
    if (netL < 0)
      buildingError('driverDisplacementL', 'Total displacement exceeds gross interior volume.');
    return {
      innerWidthCm,
      innerHeightCm,
      innerDepthCm,
      grossL,
      netL,
      grossFt3: grossL / 28.316846592,
      netFt3: netL / 28.316846592,
      status: netL === 0 ? 'no-air-space' : 'estimate',
    };
  },
};

export function calculateHardware(id: string, p: UtilityParams, ctx: ToolRunContext): UtilityResult | Promise<UtilityResult> {
  if (!Object.hasOwn(calculations, id)) throw new UtilityInputError('$tool', 'unknown', 'Unknown hardware calculator.');
  return calculations[id]!(p, ctx);
}

