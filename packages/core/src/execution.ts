// Browser execution API: reuse the public API's original owners and shared state.
export { analyzeMp3File } from './utilities/mp3-to-midi.js';
export { assertUnicode, cspHeader, hreflangTags, nginxRedirects, parseTextRows, robotsText } from './utilities/text-developer.js';
export { bankDefaults, exportBankStatement, reviewBankStatement, validateBankParams } from './utilities/bank-statement.js';
export {
  calculateConstructionEstimate,
  validateBoardFootPieces,
  validateConstructionEstimate,
  validateGutterCandidates,
} from './utilities/building.js';
export { checkToolCapabilities, detectCapabilities } from './lib/capabilities.js';
export { clearPipelineCache } from './lib/transformers.js';
export {
  cloneUtilityJson,
  numberParam,
  utilityDependencyOrder,
  utilityFieldOptions,
  utilityFieldVisible,
  UtilityInputError,
  validateUtilityParams,
} from './utilities/common.js';
export { couldFlowTo, mimeMatches } from './registry.js';
export { createDefaultRegistry } from './default-registry.js';
export { createMp3Decoder } from './utilities/midi-audio.js';
export {
  DEFAULT_RATE_LIMIT,
  matchRule,
  parseTriggerKit,
  pruneFires,
  readFileHeader,
  runPreflight,
  serializeTriggerKit,
  strippedForImport,
  TRIGGER_KIT_VERSION,
  updateTriggerRule,
} from './triggers/index.js';
export { editCsvCell, exportCsv, parseCsv, selectCsvRows } from './utilities/csv-data.js';
export { encodePitchMidi, selectPitchNotes, validatePitchParams } from './utilities/midi-pitch.js';
export { fileMatchesMime } from './lib/input-validation.js';
export { financeSourcesForTool } from './utilities/finance.js';
export {
  parseGradeWeight,
  parsePlanningRows,
  safeCsvCell,
  validateContractParticulars,
  validatePlanningSnapshot,
} from './utilities/planning.js';
export {
  readGamepadSnapshot,
  summarizeTouchscreenSession,
  touchscreenCellIndex,
  validateGeneratorLoads,
} from './utilities/hardware.js';
export { runBankFileJob } from './utilities/bank-job.js';
export { runChain } from './chain/engine.js';
export { runCsvFileJob } from './utilities/file-job.js';
export { runStlFileJob } from './utilities/stl-job.js';
export { setModelCdn } from './lib/model-cdn.js';
export { STL_LIMITS, validateStlParams } from './utilities/stl-contours.js';
export { validateChain } from './chain/validate.js';

// Types do not introduce a runtime dependency on the catalogue barrel.
export type * from './index.js';
