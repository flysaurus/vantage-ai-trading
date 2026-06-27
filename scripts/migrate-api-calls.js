#!/usr/bin/env node
/**
 * Precise migration: replace raw fetch('/api/...') with apiGet/apiPost/apiDelete.
 * Uses bracket-counting to find the full call expression, then rewrites it.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Files with calls that still need migration
const FILES = execSync(
  `grep -rl "fetch('/api/" ${ROOT}/app ${ROOT}/components ${ROOT}/context ${ROOT}/lib --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules`,
  { encoding: 'utf8' }
).trim().split('\n').filter(Boolean);

// Skip dead auth code — these call routes that no longer exist
const SKIP = new Set([
  'components/providers/AuthProvider.tsx',
  'components/providers/BrokerProvider.tsx',  // already fixed
  'components/onboarding/BrokerGate.tsx',      // already fixed
  'components/app/MainApp.tsx',                 // already fixed
  'components/GreetingModal.tsx',               // calls dead /api/auth/me — skip
  'lib/onboarding/quiz-logic.ts',              // calls dead /api/auth/me — skip
]);

/**
 * Find a matching closing bracket from a given position.
 * Respects nested brackets and string literals.
 */
function findMatchingBrace(str, openPos, openChar, closeChar) {
  let depth = 1;
  let inString = false;
  let stringChar = '';
  let inTemplate = false;
  
  for (let i = openPos + 1; i < str.length; i++) {
    const c = str[i];
    const prev = i > 0 ? str[i - 1] : '';
    
    if (!inString && !inTemplate) {
      if (c === '"' || c === "'") { inString = true; stringChar = c; continue; }
      if (c === '`') { inTemplate = true; continue; }
    } else if (inString && c === stringChar && prev !== '\\') {
      inString = false;
    } else if (inTemplate && c === '`' && prev !== '\\') {
      inTemplate = false;
    }
    
    if (inString || inTemplate) continue;
    
    if (c === openChar) depth++;
    if (c === closeChar) depth--;
    if (depth === 0) return i;
  }
  return -1;
}

/**
 * Extract the full body argument of a fetch call.
 * For: fetch('/api/foo', { method: 'POST', body: JSON.stringify({...}), headers: {...} })
 * Returns: { method, bodyExpr, headersObj, otherOpts }
 */
function parseFetchArgs(argsStr) {
  const result = { method: 'GET', bodyExpr: null, headersObj: null, otherOpts: [], hasInit: false };
  
  // Find the comma between endpoint and init object
  let depth = 0;
  let commaPos = -1;
  for (let i = 0; i < argsStr.length; i++) {
    if (argsStr[i] === '(' || argsStr[i] === '{') depth++;
    if (argsStr[i] === ')' || argsStr[i] === '}') depth--;
    if (argsStr[i] === ',' && depth === 0) {
      commaPos = i;
      break;
    }
  }
  
  if (commaPos === -1) return result; // just fetch('/api/x') — no options
  
  result.hasInit = true;
  const initStr = argsStr.substring(commaPos + 1).trim();
  
  // Extract method
  const methodMatch = initStr.match(/\bmethod:\s*['"]([A-Z]+)['"]/);
  if (methodMatch) result.method = methodMatch[1];
  
  // Extract body (JSON.stringify(...))
  const bodyMatch = initStr.match(/\bbody:\s*(JSON\.stringify\s*\([^)]*(?:\([^)]*\)[^)]*)*\))/);
  if (bodyMatch) result.bodyExpr = bodyMatch[1];
  
  // Check for cache
  if (/cache:\s*['"]no-store['"]/.test(initStr)) {
    result.otherOpts.push("cache: 'no-store'");
  }
  
  return result;
}

function getApiFunc(method, hasBody) {
  if (method === 'DELETE') return 'apiDelete';
  if (method === 'PUT') return hasBody ? 'apiPost' : 'apiPut';
  if (method === 'POST') return 'apiPost';
  return 'apiGet';
}

function processFile(filePath) {
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (SKIP.has(relPath)) {
    console.log(`  SKIP: ${relPath}`);
    return { file: relPath, changes: 0, added: new Set() };
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;
  const usedFuncs = new Set();
  
  // Find all fetch('/api/...') occurrences
  let idx = 0;
  let changes = 0;
  const regex = /\bfetch\s*\(\s*['"]\/api\//g;
  
  // We need to work backwards so indices stay valid
  const replacements = [];
  
  let match;
  while ((match = regex.exec(content)) !== null) {
    const startIdx = match.index;
    
    // Find the '(' position
    const parenOpen = content.indexOf('(', startIdx + 5);
    if (parenOpen === -1) continue;
    
    // Find matching ')'
    const parenClose = findMatchingBrace(content, parenOpen, '(', ')');
    if (parenClose === -1) continue;
    
    const fullCall = content.substring(startIdx, parenClose + 1);
    const args = content.substring(parenOpen + 1, parenClose);
    
    // Extract endpoint
    const epMatch = args.match(/^['"`](\/api\/[^'"`]+)['"`]/);
    if (!epMatch) continue;
    const endpoint = epMatch[1];
    
    // Parse init options
    const parsed = parseFetchArgs(args);
    
    const apiFunc = getApiFunc(parsed.method, !!parsed.bodyExpr);
    
    // Build replacement
    let newCall;
    if (parsed.method === 'DELETE' && !parsed.bodyExpr) {
      newCall = `await ${apiFunc}('${endpoint}')`;
    } else if (parsed.bodyExpr) {
      newCall = `await ${apiFunc}('${endpoint}', ${parsed.bodyExpr})`;
    } else if (parsed.otherOpts.length > 0) {
      newCall = `await ${apiFunc}('${endpoint}', { ${parsed.otherOpts.join(', ')} })`;
    } else if (parsed.method === 'GET') {
      newCall = `await ${apiFunc}('${endpoint}')`;
    } else {
      // Fall back — just swap fetch → apiGet and strip method/headers/body
      newCall = `await ${apiFunc}('${endpoint}')`;
    }
    
    replacements.push({ startIdx, endIdx: parenClose + 1, newCall, apiFunc });
    changes++;
  }
  
  if (changes === 0) {
    console.log(`  NONE: ${relPath} (no fetch to convert)`);
    return { file: relPath, changes: 0, added: new Set() };
  }
  
  // Apply replacements in reverse order
  replacements.sort((a, b) => b.startIdx - a.startIdx);
  for (const rep of replacements) {
    content = content.substring(0, rep.startIdx) + rep.newCall + content.substring(rep.endIdx);
    usedFuncs.add(rep.apiFunc);
  }
  
  // Remove unused getAccessToken import
  if (!/getAccessToken/.test(content.match(/\bgetAccessToken\b/g)?.join('') || '')) {
    content = content.replace(/import\s+\{[^}]*getAccessToken[^}]*\}\s+from\s+['"]@\/lib\/auth['"];?\n?/g, '');
  }
  
  // Remove unused token variable if present and now unused
  if (usedFuncs.size > 0 && content.includes('const token =')) {
    const tokenLine = content.match(/.*const\s+token\s*=\s*getAccessToken\(\);?.*\n?/);
    if (tokenLine && !/token/.test(content.replace(tokenLine[0], '').match(/(?<!getAccess)token/g)?.join('') || '')) {
      content = content.replace(tokenLine[0], '');
    }
    // Also remove headers blocks that reference token
    content = content.replace(/\s*const\s+headers[^;]+token[^;]+;[^\n]*\n/g, '\n');
    content = content.replace(/\s*if\s*\(token\)\s*\{\s*headers\['Authorization'\]\s*=\s*[^}]+\}\s*\n?/g, '\n');
  }
  
  // Add or update import
  const funcsStr = Array.from(usedFuncs).sort().join(', ');
  const importLine = `import { ${funcsStr} } from '@/lib/api-client';`;
  
  if (/from ['"]@\/lib\/api-client['"]/.test(content)) {
    // Replace existing api-client import
    content = content.replace(
      /import\s+\{[^}]+\}\s+from\s+['"]@\/lib\/api-client['"];?/,
      importLine
    );
  } else {
    // Insert after 'use client' or last import
    if (content.startsWith("'use client'") || content.startsWith('"use client"')) {
      const afterDirective = content.indexOf('\n', content.indexOf("'use client'")) + 1;
      content = content.substring(0, afterDirective) + '\n' + importLine + '\n' + content.substring(afterDirective);
    } else {
      // Insert after last import statement
      const importLines = [...content.matchAll(/^import .+$/gm)];
      if (importLines.length > 0) {
        const lastImport = importLines[importLines.length - 1];
        const insertPos = lastImport.index + lastImport[0].length + 1;
        content = content.substring(0, insertPos) + importLine + '\n' + content.substring(insertPos);
      }
    }
  }
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  DONE: ${relPath} (${changes} calls → ${funcsStr})`);
  }
  
  return { file: relPath, changes, added: usedFuncs };
}

// Main
console.log(`Processing ${FILES.length} files...\n`);

let totalChanges = 0;
const totalFuncs = new Set();

for (const file of FILES) {
  const result = processFile(file);
  totalChanges += result.changes;
  result.added.forEach(f => totalFuncs.add(f));
}

console.log(`\n✅ ${totalChanges} fetch calls migrated in ${FILES.length} files`);
console.log(`   Functions used: ${Array.from(totalFuncs).sort().join(', ') || '(none)'}`);
