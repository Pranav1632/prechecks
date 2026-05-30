import { parse } from '@babel/parser';
import { BtmError } from '../utils/errors.js';

const DEFAULT_PLUGINS = [
  'typescript',
  'jsx',
  'classProperties',
  'classPrivateProperties',
  'classPrivateMethods',
  'decorators-legacy',
  'dynamicImport',
  'importMeta',
  'topLevelAwait'
];

export function parseSource(source, { filePath = 'unknown' } = {}) {
  try {
    const ast = parse(source, {
      sourceType: 'unambiguous',
      sourceFilename: filePath,
      errorRecovery: true,
      plugins: DEFAULT_PLUGINS
    });

    if (ast.errors?.length > 0) {
      throw ast.errors[0];
    }

    return ast;
  } catch (error) {
    throw new BtmError(`Unable to parse ${filePath}: ${error.message}`);
  }
}
