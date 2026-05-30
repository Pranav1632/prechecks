import traverseModule from '@babel/traverse';
import { parseSource } from './parser.js';

const traverse = traverseModule.default;
const SQL_PATTERN = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b/i;
const SECRET_NAME_PATTERN = /(api[_-]?key|secret|token|password|credential)/i;
const COMMON_METHOD_NAMES = [
  'toDateString',
  'toISOString',
  'toLocaleDateString',
  'toLocaleString',
  'toString',
  'getDate',
  'getDay',
  'getFullYear',
  'getMonth',
  'setDate',
  'map',
  'find',
  'filter',
  'reduce',
  'includes',
  'startsWith',
  'endsWith',
  'trim',
  'toLowerCase',
  'toUpperCase'
];
const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod'
]);

export function analyzeSecurityFindings(functions) {
  return functions.flatMap((fn) => analyzeFunctionSecurity(fn));
}

function analyzeFunctionSecurity(fn) {
  const findings = [];
  const ast = parseFunctionCode(fn);

  if (!ast) {
    return findings;
  }

  traverse(ast, {
    enter(path, state) {
      if (!FUNCTION_TYPES.has(path.node.type)) {
        return;
      }

      if (state.seenRootFunction) {
        path.skip();
        return;
      }

      state.seenRootFunction = true;
    },
    CallExpression(path) {
      if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'eval') {
        findings.push(buildFinding(fn, path.node, 'dangerous-eval', 'high', 'Use of eval() can execute untrusted code.'));
      }

      const suspiciousMethod = findSuspiciousMethodName(path.node.callee);
      if (suspiciousMethod) {
        findings.push(
          buildFinding(
            fn,
            path.node,
            'suspicious-api-call',
            'medium',
            `Suspicious method ${suspiciousMethod.actual}(); did you mean ${suspiciousMethod.expected}()?`
          )
        );
      }
    },
    NewExpression(path) {
      if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'Function') {
        findings.push(buildFinding(fn, path.node, 'dynamic-function', 'high', 'new Function() can execute untrusted code.'));
      }
    },
    VariableDeclarator(path) {
      const name = path.node.id.type === 'Identifier' ? path.node.id.name : '';
      const init = path.node.init;

      if (
        SECRET_NAME_PATTERN.test(name) &&
        init?.type === 'StringLiteral' &&
        init.value.length >= 16
      ) {
        findings.push(buildFinding(fn, path.node, 'exposed-secret', 'critical', `Possible hard-coded secret in ${name}.`));
      }
    },
    CatchClause(path) {
      if (path.node.body.body.length === 0) {
        findings.push(buildFinding(fn, path.node, 'exception-swallowing', 'medium', 'Empty catch block swallows exceptions.'));
      }
    },
    BinaryExpression(path) {
      if (path.node.operator === '+' && expressionContainsSql(path.node)) {
        findings.push(buildFinding(fn, path.node, 'sql-injection', 'high', 'Possible SQL query string concatenation.'));
      }
    },
    TemplateLiteral(path) {
      const hasSql = path.node.quasis.some((part) => SQL_PATTERN.test(part.value.raw));

      if (hasSql && path.node.expressions.length > 0) {
        findings.push(buildFinding(fn, path.node, 'sql-injection', 'high', 'Possible SQL template interpolation.'));
      }
    }
  }, undefined, { seenRootFunction: false });

  return findings;
}

function parseFunctionCode(fn) {
  const wrapped = wrapFunctionForParsing(fn);

  try {
    return parseSource(wrapped, { filePath: fn.filePath });
  } catch {
    return null;
  }
}

function expressionContainsSql(node) {
  if (!node) {
    return false;
  }

  if (node.type === 'StringLiteral') {
    return SQL_PATTERN.test(node.value);
  }

  if (node.type === 'BinaryExpression') {
    return expressionContainsSql(node.left) || expressionContainsSql(node.right);
  }

  return false;
}

function buildFinding(fn, node, ruleId, severity, message) {
  return {
    ruleId,
    severity,
    message,
    filePath: fn.filePath,
    functionId: fn.id,
    functionName: fn.name,
    line: node.loc ? fn.loc.start.line + node.loc.start.line - 1 : fn.loc.start.line
  };
}

function wrapFunctionForParsing(fn) {
  if (fn.kind === 'ObjectMethod') {
    return `({ ${fn.code} })`;
  }

  if (fn.kind === 'ClassMethod' || fn.kind === 'ClassPrivateMethod') {
    return `class __BtmSecurityAuditWrapper { ${fn.code} }`;
  }

  return `(${fn.code})`;
}

function findSuspiciousMethodName(callee) {
  if (
    callee.type !== 'MemberExpression' ||
    callee.computed ||
    callee.property.type !== 'Identifier'
  ) {
    return null;
  }

  const actual = callee.property.name;
  const expected = COMMON_METHOD_NAMES.find((methodName) => {
    if (methodName === actual) {
      return false;
    }

    return levenshteinDistance(methodName, actual) <= 2;
  });

  return expected
    ? {
        actual,
        expected
      }
    : null;
}

function levenshteinDistance(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}
