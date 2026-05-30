import traverseModule from '@babel/traverse';
import { parseSource } from './parser.js';

const traverse = traverseModule.default;
const SQL_PATTERN = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b/i;
const SECRET_NAME_PATTERN = /(api[_-]?key|secret|token|password|credential)/i;

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
    CallExpression(path) {
      if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'eval') {
        findings.push(buildFinding(fn, path.node, 'dangerous-eval', 'high', 'Use of eval() can execute untrusted code.'));
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
  });

  return findings;
}

function parseFunctionCode(fn) {
  const wrapped = fn.kind === 'ObjectMethod' ? `({ ${fn.code} })` : `(${fn.code})`;

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
    line: node.loc?.start.line ?? fn.loc.start.line
  };
}
