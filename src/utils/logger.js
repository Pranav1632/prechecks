const colors = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  magenta: '\u001b[35m',
  blue: '\u001b[34m',
  white: '\u001b[37m',
  dim: '\u001b[2m'
};

export function paint(color, value) {
  if (!process.stdout.isTTY && !process.stderr.isTTY) {
    return value;
  }

  return `${colors[color]}${value}${colors.reset}`;
}

export const logger = {
  header(message) {
    console.log(paint('cyan', paint('bold', message)));
  },

  section(message) {
    console.log('');
    console.log(paint('cyan', paint('bold', message)));
  },

  raw(message = '') {
    console.log(message);
  },

  info(message) {
    console.log(`${paint('dim', 'info')} ${message}`);
  },

  highlight(label, message, color = 'cyan') {
    console.log(`${paint(color, paint('bold', label))} ${message}`);
  },

  success(message) {
    console.log(`${paint('green', 'ok')} ${message}`);
  },

  warn(message) {
    console.warn(`${paint('yellow', 'warn')} ${message}`);
  },

  error(message) {
    console.error(`${paint('red', 'error')} ${message}`);
  }
};
