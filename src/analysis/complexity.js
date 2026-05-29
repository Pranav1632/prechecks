import traverseModule from '@babel/traverse';

const traverse = traverseModule.default;

const COMPLEXITY_VISITORS = {
  IfStatement(path, state) {
    increment(path, state);
  },
  ConditionalExpression(path, state) {
    increment(path, state);
  },
  ForStatement(path, state) {
    increment(path, state);
  },
  ForInStatement(path, state) {
    increment(path, state);
  },
  ForOfStatement(path, state) {
    increment(path, state);
  },
  WhileStatement(path, state) {
    increment(path, state);
  },
  DoWhileStatement(path, state) {
    increment(path, state);
  },
  CatchClause(path, state) {
    increment(path, state);
  },
  LogicalExpression(path, state) {
    if (path.node.operator === '&&' || path.node.operator === '||' || path.node.operator === '??') {
      increment(path, state);
    }
  },
  AssignmentPattern(path, state) {
    increment(path, state);
  },
  SwitchCase(path, state) {
    if (path.node.test) {
      increment(path, state);
    }
  }
};

export function calculateCyclomaticComplexity(functionPath) {
  const state = {
    score: 1,
    reasons: []
  };

  functionPath.traverse(COMPLEXITY_VISITORS, state);

  return {
    cyclomaticComplexity: state.score,
    threshold: 15,
    isOverThreshold: state.score > 15,
    reasons: state.reasons
  };
}

export function calculateProgramComplexity(ast) {
  const functions = [];

  traverse(ast, {
    FunctionDeclaration(path) {
      functions.push(calculateCyclomaticComplexity(path));
    },
    FunctionExpression(path) {
      functions.push(calculateCyclomaticComplexity(path));
    },
    ArrowFunctionExpression(path) {
      functions.push(calculateCyclomaticComplexity(path));
    },
    ObjectMethod(path) {
      functions.push(calculateCyclomaticComplexity(path));
    },
    ClassMethod(path) {
      functions.push(calculateCyclomaticComplexity(path));
    },
    ClassPrivateMethod(path) {
      functions.push(calculateCyclomaticComplexity(path));
    }
  });

  return functions;
}

function increment(path, state) {
  state.score += 1;
  state.reasons.push({
    type: path.node.type,
    line: path.node.loc?.start.line ?? null
  });
}
