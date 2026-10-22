// The fresh built registry supplies metadata; source AST membership guards against
// stale builds. Directory names are only a missing legacy-registration oracle.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function parseTs(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  requireCondition(source.parseDiagnostics.length === 0, `Invalid TypeScript: ${path}`);
  return source;
}

function variable(source, name) {
  const declarations = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name);
  requireCondition(declarations.length === 1, `Expected one ${name} declaration`);
  return declarations[0].initializer;
}

function literalName(node) {
  requireCondition(
    node && (ts.isIdentifier(node) || ts.isStringLiteral(node)),
    'Expected literal property name (no computed keys)',
  );
  return node.text;
}

function literalMap(node, label, value) {
  requireCondition(node && ts.isObjectLiteralExpression(node), `${label} must be a literal object`);
  const entries = new Map();
  for (const property of node.properties) {
    requireCondition(ts.isPropertyAssignment(property), `${label}: no spread, method or shorthand`);
    const key = literalName(property.name);
    requireCondition(!entries.has(key), `${label}: duplicate key ${key}`);
    entries.set(key, value(property.initializer, key));
  }
  return entries;
}

function uniqueIds(tools, label) {
  requireCondition(Array.isArray(tools), `${label} must be an array`);
  const ids = tools.map((tool) => {
    requireCondition(typeof tool?.id === 'string', `${label}: missing tool ID`);
    return tool.id;
  });
  requireCondition(new Set(ids).size === ids.length, `${label}: duplicate tool ID`);
  return ids;
}

function sameIds(actual, expected, label) {
  const missing = expected.filter((id) => !actual.includes(id));
  const stale = actual.filter((id) => !expected.includes(id));
  requireCondition(
    missing.length === 0 && stale.length === 0,
    `${label}: missing [${missing.join(', ')}]; stale [${stale.join(', ')}]`,
  );
}

function registeredSourceIds(root, core, source) {
  const imports = new Map();
  for (const statement of source.statements.filter(ts.isImportDeclaration)) {
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    requireCondition(
      ts.isStringLiteral(statement.moduleSpecifier),
      'Expected literal registry import',
    );
    for (const binding of bindings.elements) {
      if (statement.importClause.isTypeOnly || binding.isTypeOnly) continue;
      imports.set(binding.name.text, {
        exported: binding.propertyName?.text ?? binding.name.text,
        module: statement.moduleSpecifier.text,
      });
    }
  }
  const array = variable(source, 'defaultTools');
  requireCondition(
    array && ts.isArrayLiteralExpression(array),
    'defaultTools must be a literal array',
  );
  const ids = [];
  for (const element of array.elements) {
    const spread = ts.isSpreadElement(element);
    const reference = spread ? element.expression : element;
    requireCondition(
      ts.isIdentifier(reference),
      'defaultTools requires imported named tools/groups',
    );
    const binding = imports.get(reference.text);
    requireCondition(binding, `Unimported default tool/group: ${reference.text}`);
    let metadata = core[binding.exported];
    if (!metadata && !spread) {
      // Some legacy tools are intentionally not individually public exports.
      // Their literal ID is read only from the exact imported declaration.
      requireCondition(binding.module.startsWith('./'), 'Expected local tool import');
      const path = resolve(root, 'packages/core/src', binding.module.replace(/\.js$/, '.ts'));
      const toolSource = parseTs(path, readFileSync(path, 'utf8'));
      const declaration = variable(toolSource, binding.exported);
      requireCondition(
        declaration && ts.isObjectLiteralExpression(declaration),
        `Nonliteral tool: ${reference.text}`,
      );
      const id = declaration.properties.filter(
        (property) => ts.isPropertyAssignment(property) && literalName(property.name) === 'id',
      );
      requireCondition(
        id.length === 1 && ts.isStringLiteral(id[0].initializer),
        `Nonliteral tool ID: ${reference.text}`,
      );
      metadata = { id: id[0].initializer.text };
    }
    ids.push(...uniqueIds(spread ? metadata : [metadata], reference.text));
  }
  requireCondition(new Set(ids).size === ids.length, 'Source defaultTools: duplicate tool ID');
  return ids;
}

export async function checkRunnerCoverage({ root = projectRoot, core } = {}) {
  core ??= await import(pathToFileURL(join(root, 'packages/core/dist/node/index.js')).href);
  const registryIds = uniqueIds(core.createDefaultRegistry().tools, 'Built default registry');
  const builtIds = uniqueIds(core.defaultTools, 'Built defaultTools');
  sameIds(registryIds, builtIds, 'Built default registry/defaultTools');
  const defaultPath = join(root, 'packages/core/src/default-registry.ts');
  const sourceIds = registeredSourceIds(
    root,
    core,
    parseTs(defaultPath, readFileSync(defaultPath, 'utf8')),
  );
  sameIds(sourceIds, registryIds, 'Source registration/built registry');
  const directories = readdirSync(join(root, 'packages/core/src/tools'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  requireCondition(
    directories.every((id) => sourceIds.includes(id)),
    'Legacy tool directory missing registration',
  );
  const webIds = uniqueIds(
    core
      .createDefaultRegistry()
      .tools.filter((tool) => tool.surfaces === undefined || tool.surfaces.includes('web')),
    'Web registry',
  );
  const mapPath = join(root, 'packages/web/src/components/runners/variantMap.ts');
  const mapSource = parseTs(mapPath, readFileSync(mapPath, 'utf8'));
  const variants = literalMap(variable(mapSource, 'VARIANT_MAP'), 'VARIANT_MAP', (node) => {
    requireCondition(ts.isStringLiteral(node), 'VARIANT_MAP values must be literal strings');
    return node.text;
  });
  sameIds([...variants.keys()], webIds, 'VARIANT_MAP/web registry');
  const variantTypes = mapSource.statements.filter(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'RunnerVariant',
  );
  requireCondition(
    variantTypes.length === 1 && ts.isUnionTypeNode(variantTypes[0].type),
    'Expected RunnerVariant literal union',
  );
  const declaredVariants = variantTypes[0].type.types.map((node) => {
    requireCondition(
      ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal),
      'RunnerVariant must contain only string literals',
    );
    return node.literal.text;
  });
  requireCondition(
    new Set(declaredVariants).size === declaredVariants.length,
    'Duplicate RunnerVariant',
  );
  const runnerPath = join(root, 'packages/web/src/components/ToolRunner.svelte');
  const runnerText = readFileSync(runnerPath, 'utf8');
  const webRequire = createRequire(join(root, 'packages/web/package.json'));
  const { parse } = webRequire('svelte/compiler');
  const parsed = parse(runnerText, { modern: true, filename: runnerPath });
  requireCondition(parsed.instance?.content, 'ToolRunner requires an instance script');
  const { start, end } = parsed.instance.content;
  const runnerSource = parseTs(runnerPath, runnerText.slice(start, end));
  const loaders = literalMap(
    variable(runnerSource, 'variantLoaders'),
    'variantLoaders',
    (node, key) => {
      requireCondition(
        ts.isArrowFunction(node) && node.parameters.length === 0,
        `${key}: loader must be callable`,
      );
      const call = node.body;
      requireCondition(
        ts.isCallExpression(call) &&
          call.expression.kind === ts.SyntaxKind.ImportKeyword &&
          call.arguments.length === 1 &&
          ts.isStringLiteral(call.arguments[0]),
        `${key}: expected literal import`,
      );
      const target = call.arguments[0].text;
      requireCondition(
        target.startsWith('./runners/') && target.endsWith('.svelte'),
        `${key}: invalid runner import`,
      );
      const path = resolve(dirname(runnerPath), target);
      requireCondition(
        existsSync(path) && statSync(path).isFile(),
        `${key}: missing import target ${target}`,
      );
      return target;
    },
  );
  sameIds([...loaders.keys()], declaredVariants, 'Loaders/RunnerVariant');
  requireCondition(
    [...variants.values()].every((variant) => loaders.has(variant)),
    'Missing runner loader',
  );
  return { tools: webIds.length, registeredTools: registryIds.length, variants: loaders.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkRunnerCoverage();
    console.log(
      `runner coverage: ok (${result.tools} web tools, ${result.variants} callable variants)`,
    );
  } catch (error) {
    console.error(`runner coverage: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
