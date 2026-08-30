import {FORMULA_FUNCTIONS_BY_NAME} from "./formula-functions.js";

export const TokenType = {
  IDENT: "IDENT",
  NUMBER: "NUMBER",
  STRING: "STRING",
  OPERATOR: "OPERATOR",
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  COMMA: "COMMA",
  DOT: "DOT",
  EOF: "EOF",
  UNKNOWN: "UNKNOWN",
};

const OPERATORS = ["<>", "<=", ">=", "&&", "||", "+", "-", "*", "/", "^", "&", "=", "<", ">", "!"];

// Tokenizes a Salesforce formula. Strings use double quotes (with backslash escaping) and
// cannot span multiple lines. There is no comment syntax in Salesforce formulas.
export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  function advance(n = 1) {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  }
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      advance();
      continue;
    }
    const startLine = line;
    const startCol = col;
    const start = i;
    if (ch === "\"") {
      advance();
      let closed = false;
      while (i < src.length) {
        if (src[i] === "\\" && src[i + 1] === "\"") {
          advance(2);
          continue;
        }
        if (src[i] === "\"") {
          advance();
          closed = true;
          break;
        }
        if (src[i] === "\n") {
          break;
        }
        advance();
      }
      tokens.push({type: TokenType.STRING, raw: src.slice(start, i), start, end: i, line: startLine, col: startCol, closed});
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) {
        j++;
      }
      if (src[j] === "." && /[0-9]/.test(src[j + 1])) {
        j++;
        while (j < src.length && /[0-9]/.test(src[j])) {
          j++;
        }
      }
      tokens.push({type: TokenType.NUMBER, raw: src.slice(i, j), start, end: j, line: startLine, col: startCol});
      advance(j - i);
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) {
        j++;
      }
      tokens.push({type: TokenType.IDENT, value: src.slice(i, j), start, end: j, line: startLine, col: startCol});
      advance(j - i);
      continue;
    }
    if (ch === "(") {
      tokens.push({type: TokenType.LPAREN, start, end: i + 1, line: startLine, col: startCol});
      advance();
      continue;
    }
    if (ch === ")") {
      tokens.push({type: TokenType.RPAREN, start, end: i + 1, line: startLine, col: startCol});
      advance();
      continue;
    }
    if (ch === ",") {
      tokens.push({type: TokenType.COMMA, start, end: i + 1, line: startLine, col: startCol});
      advance();
      continue;
    }
    if (ch === ".") {
      tokens.push({type: TokenType.DOT, start, end: i + 1, line: startLine, col: startCol});
      advance();
      continue;
    }
    const op = OPERATORS.find(o => src.startsWith(o, i));
    if (op) {
      tokens.push({type: TokenType.OPERATOR, value: op, start, end: i + op.length, line: startLine, col: startCol});
      advance(op.length);
      continue;
    }
    tokens.push({type: TokenType.UNKNOWN, value: ch, start, end: i + 1, line: startLine, col: startCol});
    advance();
  }
  tokens.push({type: TokenType.EOF, start: i, end: i, line, col});
  return tokens;
}

function formatArity(minArgs, maxArgs) {
  if (maxArgs == null) {
    return minArgs + "+";
  }
  return minArgs === maxArgs ? String(minArgs) : minArgs + "-" + maxArgs;
}

// Single left-to-right scan producing structured errors with line/col.
// `blocking: true` errors (unclosed/unmatched parens, unterminated strings) mean the paren
// structure is broken; formatting should not be attempted until they are fixed.
// `blocking: false` errors (arity, misplaced commas, unknown functions) are informational.
export function analyzeFormula(tokens) {
  const errors = [];
  const stack = [];

  function report(severity, blocking, token, message) {
    errors.push({severity, blocking, message, line: token.line, col: token.col, start: token.start, end: token.end});
  }

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];

    if (t.type === TokenType.STRING && !t.closed) {
      report("error", true, t, "Unterminated string literal");
    }

    if (t.type === TokenType.LPAREN) {
      const prev = tokens[idx - 1];
      const isCall = prev && prev.type === TokenType.IDENT;
      const funcDef = isCall ? FORMULA_FUNCTIONS_BY_NAME.get(prev.value.toUpperCase()) : null;
      stack.push({open: t, isCall, funcName: isCall ? prev.value : null, funcDef, argCount: 1, sawTokenInArg: false});
      continue;
    }

    if (t.type === TokenType.RPAREN) {
      if (stack.length === 0) {
        report("error", true, t, "Unexpected ')' — no matching '('");
        continue;
      }
      const frame = stack.pop();
      const prevReal = tokens[idx - 1];
      if (frame.isCall && prevReal && prevReal.type === TokenType.COMMA) {
        report("error", false, t, "Missing argument before ')' in " + frame.funcName + "()");
      }
      if (frame.isCall) {
        if (!frame.funcDef) {
          report("warning", false, frame.open, "Unknown function '" + frame.funcName + "'");
        } else {
          const provided = frame.sawTokenInArg || frame.argCount > 1 ? frame.argCount : 0;
          const {minArgs, maxArgs} = frame.funcDef;
          if (provided < minArgs || (maxArgs != null && provided > maxArgs)) {
            report("error", false, frame.open,
              frame.funcName + "() expects " + formatArity(minArgs, maxArgs) + " argument(s), got " + provided);
          }
        }
      }
      continue;
    }

    if (t.type === TokenType.COMMA) {
      if (stack.length === 0 || !stack[stack.length - 1].isCall) {
        report("error", false, t, "Comma outside of a function call");
      } else {
        const frame = stack[stack.length - 1];
        if (!frame.sawTokenInArg) {
          report("error", false, t, "Missing argument before ','");
        }
        frame.argCount++;
        frame.sawTokenInArg = false;
      }
      continue;
    }

    if (t.type !== TokenType.EOF && stack.length) {
      stack[stack.length - 1].sawTokenInArg = true;
    }
  }

  for (const frame of stack) {
    report("error", true, frame.open, frame.isCall ? "'" + frame.funcName + "(' is never closed" : "'(' is never closed");
  }

  return errors;
}
