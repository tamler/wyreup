import type { ParamFieldSchema, ToolModule } from '../types.js';
import { createUtility, numberParam, stringParam, UtilityInputError, type UtilityParams } from './common.js';
import { sampleUniqueIntegers, secureUint32, type Uint32Reader } from './planning.js';

const adjectives = ['Quiet', 'Brisk', 'Hidden', 'Open', 'Bright', 'Curious', 'Steady', 'Wild'];
const nouns = ['Harbor', 'Signal', 'Trail', 'Window', 'Compass', 'Orbit', 'Current', 'Notebook'];
const bands: Record<string, [string[], string[]]> = {
  rock: [['Iron', 'Electric', 'Ragged', 'Velvet', 'Midnight', 'Copper', 'Restless', 'Granite'], ['Echoes', 'Wheels', 'Bridges', 'Hearts', 'Signals', 'Streets', 'Satellites', 'Rivers']],
  electronic: [['Neon', 'Digital', 'Prismatic', 'Ultraviolet', 'Luminous', 'Static', 'Phase', 'Modular'], ['Circuits', 'Pulses', 'Contours', 'Mirrors', 'Pixels', 'Intervals', 'Waves', 'Fields']],
  folk: [['Willow', 'Amber', 'Autumn', 'Cedar', 'Juniper', 'Meadow', 'Silver', 'Windward'], ['Paths', 'Porches', 'Letters', 'Valleys', 'Stories', 'Branches', 'Bells', 'Footsteps']],
};
const clans: Record<string, [string[], string[]]> = {
  tactical: [['Silent', 'Forward', 'Resolute', 'Iron', 'Watchful', 'Swift', 'Covert', 'Steady'], ['Guard', 'Unit', 'Patrol', 'Outpost', 'Watch', 'Vanguard', 'Line', 'Company']],
  fantasy: [['Ember', 'Storm', 'Silver', 'Rune', 'Thorn', 'Dawn', 'Moon', 'Star'], ['Wardens', 'Keepers', 'Seekers', 'Knights', 'Weavers', 'Sentinels', 'Walkers', 'Riders']],
  playful: [['Bouncy', 'Wobbly', 'Lucky', 'Fuzzy', 'Sunny', 'Quirky', 'Cheeky', 'Snappy'], ['Badgers', 'Otters', 'Wombats', 'Pandas', 'Geckos', 'Puffins', 'Koalas', 'Crickets']],
};
const characters: Record<string, [string[], string[]]> = {
  human: [['Ar', 'Bel', 'Cor', 'Dan', 'El', 'Fen', 'Gar', 'Hel'], ['alen', 'orin', 'essa', 'amir', 'ethan', 'ira', 'olan', 'eris']],
  elf: [['Ael', 'Eli', 'Fae', 'Ily', 'Lue', 'Nae', 'Syl', 'Thae'], ['lira', 'neth', 'riel', 'wyn', 'thiel', 'vara', 'sel', 'mir']],
  dwarf: [['Bar', 'Dor', 'Far', 'Gim', 'Kor', 'Mor', 'Thar', 'Vur'], ['grim', 'dek', 'run', 'gar', 'rik', 'din', 'bor', 'nar']],
  orc: [['Brag', 'Drak', 'Ghor', 'Krag', 'Mog', 'Throg', 'Vrak', 'Zog'], ['ash', 'duk', 'gor', 'mar', 'nak', 'rok', 'thar', 'zug']],
};
const surnames = ['Ashvale', 'Brindleford', 'Copperbrook', 'Dawnridge', 'Emberfield', 'Farhollow', 'Grayfen', 'Stoneward'];
export interface NameIdea { name: string; tag: string }
function fail(message: string): never { throw new UtilityInputError('names', 'bounds', message); }
function dictionary(dict: Record<string, [string[], string[]]>, key: string): [string[], string[]] {
  if (!Object.hasOwn(dict, key)) fail('Unsupported vocabulary choice.');
  return dict[key]!;
}
export function buildNamePool(id: string, params: UtilityParams): NameIdea[] {
  const character = id === 'dnd-name-generator';
  const topic = character ? '' : stringParam(params, 'topic').trim().replace(/\s+/gu, ' ');
  if ([...topic].length > 80) fail('Topic exceeds 80 characters.');
  let first = adjectives; let second = nouns;
  if (id === 'band-name-generator') [first, second] = dictionary(bands, stringParam(params, 'genre'));
  else if (id === 'clan-name-generator') [first, second] = dictionary(clans, stringParam(params, 'style'));
  else if (character) [first, second] = dictionary(characters, stringParam(params, 'ancestry'));
  else if (id !== 'podcast-name-generator' || !['descriptive', 'conversational', 'punchy'].includes(stringParam(params, 'style'))) fail('Unsupported name generator or style.');
  const pool: NameIdea[] = [];
  for (const a of first) for (const b of second) {
    let name = `${a} ${b}`; let tag = '';
    if (character) {
      const joined = a + b; name = joined[0]!.toUpperCase() + joined.slice(1).toLowerCase();
      if (params.surname === true) { for (const surname of surnames) pool.push({ name: `${name} ${surname}`, tag: '' }); continue; }
    } else if (id === 'podcast-name-generator') {
      name = params.style === 'descriptive' ? `${a}${topic ? ` ${topic}` : ''} ${b}` : params.style === 'conversational' ? `Around ${topic ? `${topic}: ${a}` : `${a}:`} ${b}` : `${topic ? `${topic}: ` : ''}${a} + ${b}`;
    } else if (id === 'band-name-generator') name += topic ? ` / ${topic}` : '';
    else {
      tag = (a + b).toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(5, 'X').slice(0, numberParam(params, 'tagLength', { min: 2, max: 5, integer: true }));
      name += topic ? `: ${topic}` : '';
    }
    if ([...name].length > 200) fail('Generated name exceeds 200 characters.');
    pool.push({ name, tag });
  }
  if (new Set(pool.map(row => row.name)).size !== pool.length) fail('Vocabulary pattern does not produce distinct candidates.');
  return pool;
}
export function drawNameIdeas(pool: NameIdea[], count: number, readUint32: Uint32Reader = secureUint32, signal?: AbortSignal): NameIdea[] {
  if (!pool.length || count > pool.length) fail(`Only ${pool.length} distinct ideas are available.`);
  return sampleUniqueIntegers(0, pool.length - 1, count, readUint32, signal).map(index => ({ ...pool[index]! }));
}
const enumeration = (label: string, values: string[]): ParamFieldSchema => ({ type: 'enum', label, options: values.map(value => ({ value, label: value })) });
function generator(id: string, name: string, defaults: UtilityParams, extraSchema: Record<string, ParamFieldSchema>): ToolModule<UtilityParams> {
  const character = id === 'dnd-name-generator';
  return createUtility({ id, name, description: `Generate original local ${character ? 'fantasy character' : name.replace(' Name Generator', '').toLowerCase()} name ideas with selectable vocabularies.`, category: 'create', keywords: [id, 'names', 'generator', 'local'], defaults: { count: 12, ...(!character ? { topic: '' } : {}), ...defaults }, paramSchema: { count: { type: 'number', label: 'Number of ideas', min: 1, max: 50, step: 1 }, ...(!character ? { topic: { type: 'string' as const, label: 'Optional topic', maxLength: 160 } } : {}), ...extraSchema }, calculate(params, ctx) {
    const pool = buildNamePool(id, params); const ideas = drawNameIdeas(pool, numberParam(params, 'count', { min: 1, max: 50, integer: true }), secureUint32, ctx.signal);
    return { ideas: ideas.map(idea => ({ ...idea })), available: pool.length, notice: 'Name ideas; availability and trademarks have not been checked.', ...(id === 'clan-name-generator' ? { tagNote: 'Tags are abbreviations and may collide.' } : {}) };
  } });
}
export const nameTools: ToolModule<UtilityParams>[] = [
  generator('podcast-name-generator', 'Podcast Name Generator', { style: 'descriptive' }, { style: enumeration('Style', ['descriptive', 'conversational', 'punchy']) }),
  generator('band-name-generator', 'Band Name Generator', { genre: 'rock' }, { genre: enumeration('Genre', ['rock', 'electronic', 'folk']) }),
  generator('clan-name-generator', 'Clan Name Generator', { style: 'tactical', tagLength: 3 }, { style: enumeration('Style', ['tactical', 'fantasy', 'playful']), tagLength: { type: 'number', label: 'Tag length', min: 2, max: 5, step: 1 } }),
  generator('dnd-name-generator', 'Fantasy Character Name Generator', { ancestry: 'human', surname: true }, { ancestry: enumeration('Ancestry', ['human', 'elf', 'dwarf', 'orc']), surname: { type: 'boolean', label: 'Include surname' } }),
];
