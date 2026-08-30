import {tokenize, TokenType} from "./formula-parser.js";

// Function names that are always broken onto multiple lines when called, regardless of length —
// matches the "complex function" list
const COMPLEX_FUNCTION_NAMES = new Set(["IF", "OR", "AND", "CASE"]);

// Builds a lightweight tree of "atoms" from a flat token list: a plain token, or a
// "call"/"group" atom holding one sub-sequence per comma-separated argument. We never need a
// full expression-precedence AST since formatting only re-indents, it never reorders operators.
function buildAtoms(tokens) {
  let i = 0;

  function parseSequence(stopTypes) {
    const atoms = [];
    while (i < tokens.length && !stopTypes.has(tokens[i].type)) {
      const t = tokens[i];
      if (t.type === TokenType.LPAREN) {
        let name = null;
        if (atoms.length && atoms[atoms.length - 1].kind === "token" && atoms[atoms.length - 1].token.type === TokenType.IDENT) {
          name = atoms.pop().token.value;
        }
        i++; // consume "("
        const argSequences = [];
        if (i < tokens.length && tokens[i].type !== TokenType.RPAREN) {
          argSequences.push(parseSequence(new Set([TokenType.COMMA, TokenType.RPAREN])));
          while (i < tokens.length && tokens[i].type === TokenType.COMMA) {
            i++; // consume ","
            argSequences.push(parseSequence(new Set([TokenType.COMMA, TokenType.RPAREN])));
          }
        }
        if (i < tokens.length && tokens[i].type === TokenType.RPAREN) {
          i++; // consume ")"
        }
        atoms.push({kind: name != null ? "call" : "group", name, argSequences, complex: false});
        continue;
      }
      atoms.push({kind: "token", token: t});
      i++;
    }
    return atoms;
  }

  return parseSequence(new Set());
}

function tokenText(t) {
  switch (t.type) {
    case TokenType.IDENT: return t.value;
    case TokenType.NUMBER: return t.raw;
    case TokenType.STRING: return t.raw;
    case TokenType.OPERATOR: return t.value;
    case TokenType.DOT: return ".";
    default: return t.value || "";
  }
}

// Marks each "call" atom's `.complex` flag, bottom-up — ported from the reference extension's
// hasComplexChildren(): a call is complex (always rendered multi-line, regardless of length) if
// its name is IF/OR/AND/CASE, it has more than one nested function call as a direct argument, at
// least one direct argument is itself complex (complexity propagates up to the caller), or it has
// more than 3 arguments (more than 2 top-level commas — an arbitrary threshold from the source
// tool, not a Salesforce rule). "group" atoms (plain arithmetic parens, e.g. "(1 + 2) * 3") are
// never complex and never propagate their contents' complexity to an enclosing call — matches the
// source tool's behavior, even though it means a complex call nested under a group can end up
// broken onto multiple lines while the group itself stays inline around it.
function markComplexity(atoms) {
  for (const atom of atoms) {
    if (atom.kind === "token") {
      continue;
    }
    for (const seq of atom.argSequences) {
      markComplexity(seq);
    }
    if (atom.kind !== "call") {
      continue;
    }
    let functionCount = 0;
    let complexCount = 0;
    for (const seq of atom.argSequences) {
      for (const child of seq) {
        if (child.kind === "call") {
          functionCount++;
          if (child.complex) {
            complexCount++;
          }
        }
      }
    }
    const commaCount = Math.max(atom.argSequences.length - 1, 0);
    atom.complex = COMPLEX_FUNCTION_NAMES.has(atom.name.toUpperCase()) || functionCount > 1 || complexCount > 0 || commaCount > 2;
  }
}

// Renders one comma-separated sequence of atoms at the given structural depth (used as the
// 2-space indent multiplier — structural, not visual/column-based, so a broken block nested under
// an inline-rendered ancestor may look "misaligned" with its prefix; this matches the reference
// tool exactly). A complex call always expands onto multiple lines; if it directly follows an
// operator in the sequence it starts on its own line instead of just after a space (e.g.
// "Amount * IF(...)"), since otherwise it would dangle awkwardly after the operator. A simple call
// or a group is always rendered inline, no matter how long.
function renderSequence(seq, depth) {
  const indent = "  ".repeat(depth);
  const parts = seq.map((atom, idx) => {
    if (atom.kind === "token") {
      return {text: tokenText(atom.token), isDot: atom.token.type === TokenType.DOT, breakBefore: false};
    }
    const name = atom.kind === "call" ? atom.name : "";
    if (atom.kind === "call" && atom.complex && atom.argSequences.length > 0) {
      const childIndent = "  ".repeat(depth + 1);
      const argLines = atom.argSequences.map(argSeq => childIndent + renderSequence(argSeq, depth + 1));
      const prev = idx > 0 ? seq[idx - 1] : null;
      const breakBefore = prev != null && prev.kind === "token" && prev.token.type === TokenType.OPERATOR;
      return {text: name + "(\n" + argLines.join(",\n") + "\n" + indent + ")", isDot: false, breakBefore};
    }
    const args = atom.argSequences.map(argSeq => renderSequence(argSeq, depth + 1)).join(", ");
    return {text: name + "(" + args + ")", isDot: false, breakBefore: false};
  });
  let out = "";
  parts.forEach((frag, idx) => {
    if (idx === 0) {
      out = frag.text;
    } else if (frag.breakBefore) {
      out += "\n" + indent + frag.text;
    } else if (parts[idx - 1].isDot || frag.isDot) {
      out += frag.text;
    } else {
      out += " " + frag.text;
    }
  });
  return out;
}

// Pretty-prints a formula: whether a function call is broken onto multiple lines depends on its
// structural complexity (see markComplexity above), not on line length — a short IF/OR/AND/CASE
// call is always expanded, a long but "simple" call (e.g. ROUND(...)) always stays inline.
// Callers must ensure the formula has no blocking structural errors (see formula-parser.js's
// analyzeFormula) before calling this — the result is undefined otherwise.
export function formatFormula(source) {
  const tokens = tokenize(source).filter(t => t.type !== TokenType.EOF);
  const atoms = buildAtoms(tokens);
  markComplexity(atoms);
  return renderSequence(atoms, 0);
}
