import traverseModule from '@babel/traverse';
import { calculateCyclomaticComplexity } from './complexity.js';
import { parseSource } from './parser.js';
import { rangesOverlap } from './diff-parser.js';

const traverse = traverseModule.default;

const FUNCTION_NODE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod'
]);

export function isolateModifiedFunctions({
  filePath,
  source,
  changedLineRanges,
  metrics = false
}) {
  const allFunctions = analyzeFunctionsInSource({
    filePath,
    source,
    metrics
  });

  return allFunctions.filter((fn) =>
    changedLineRanges.some((range) =>
      rangesOverlap(range, {
        start: fn.loc.start.line,
        end: fn.loc.end.line
      })
    )
  );
}

export function analyzeFunctionsInSource({ filePath, source, metrics = false }) {
  const ast = parseSource(source, { filePath });
  const functions = [];

  traverse(ast, {
    enter(path) {
      if (!FUNCTION_NODE_TYPES.has(path.node.type) || !path.node.loc) {
        return;
      }

      functions.push(serializeFunctionPath({
        path,
        filePath,
        source,
        metrics
      }));
    }
  });

  return functions;
}

export function findFunctionInSource({ filePath, source, target, metrics = false }) {
  const functions = analyzeFunctionsInSource({
    filePath,
    source,
    metrics
  });

  return (
    functions.find((fn) => fn.name === target.name && fn.kind === target.kind) ??
    functions.find((fn) => fn.name === target.name) ??
    null
  );
}

function serializeFunctionPath({ path, filePath, source, metrics }) {
  const node = path.node;
  const loc = {
    start: {
      line: node.loc.start.line,
      column: node.loc.start.column
    },
    end: {
      line: node.loc.end.line,
      column: node.loc.end.column
    }
  };

  const result = {
    id: buildFunctionId({ filePath, path, loc }),
    name: inferFunctionName(path),
    kind: node.type,
    filePath,
    loc,
    code: source.slice(node.start, node.end)
  };

  if (metrics) {
    result.metrics = calculateCyclomaticComplexity(path);
  }

  return result;
}

function inferFunctionName(path) {
  const node = path.node;

  if (node.id?.name) {
    return node.id.name;
  }

  if (node.key?.name) {
    return node.key.name;
  }

  if (node.key?.value) {
    return String(node.key.value);
  }

  const parent = path.parentPath?.node;
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
    return parent.id.name;
  }

  if (parent?.type === 'AssignmentExpression') {
    return sourceName(parent.left);
  }

  if (parent?.type === 'ObjectProperty') {
    return sourceName(parent.key);
  }

  return '<anonymous>';
}

function sourceName(node) {
  if (!node) {
    return '<anonymous>';
  }

  if (node.type === 'Identifier') {
    return node.name;
  }

  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') {
    return String(node.value);
  }

  if (node.type === 'MemberExpression') {
    return [sourceName(node.object), sourceName(node.property)].filter(Boolean).join('.');
  }

  return '<anonymous>';
}

function buildFunctionId({ filePath, path, loc }) {
  const name = inferFunctionName(path);
  return `${filePath}:${name}:${loc.start.line}:${loc.start.column}`;
}
