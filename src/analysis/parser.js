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
    return parse(source, {
      sourceType: 'unambiguous',
      sourceFilename: filePath,
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      plugins: DEFAULT_PLUGINS
    });
  } catch (error) {
    throw new BtmError(`Unable to parse ${filePath}: ${error.message}`);
  }
}
