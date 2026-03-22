import { expect } from 'chai';
import { convertUnifiedToSearchReplace, fileBlockMapToString } from '../../src/evolution/sandbox';

describe('Evolution Diff Converter', () => {
  it('should convert a simple unified diff to per-file SEARCH/REPLACE blocks', () => {
    const unifiedDiff = `--- a/src/agent/circuit-breaker.ts
+++ b/src/agent/circuit-breaker.ts
@@ -133,7 +133,7 @@
   private checkThreshold(value: number): boolean {
-    return value > 0.5;
+    return value > 0.3;
   }`;

    const result = convertUnifiedToSearchReplace(unifiedDiff, {});
    expect(result).to.not.be.null;
    expect(result).to.be.instanceOf(Map);
    expect(result!.has('src/agent/circuit-breaker.ts')).to.be.true;
    const blocks = result!.get('src/agent/circuit-breaker.ts')!;
    expect(blocks.length).to.equal(1);
    expect(blocks[0].search).to.include('return value > 0.5;');
    expect(blocks[0].replace).to.include('return value > 0.3;');

    // Verify string serialization works
    const str = fileBlockMapToString(result!);
    expect(str).to.include('<<<<<<< SEARCH');
    expect(str).to.include('>>>>>>> REPLACE');
    expect(str).to.include('// File: src/agent/circuit-breaker.ts');
  });

  it('should handle multi-hunk diffs', () => {
    const unifiedDiff = `--- a/src/instinct/reflexes/pattern-matcher.ts
+++ b/src/instinct/reflexes/pattern-matcher.ts
@@ -10,3 +10,3 @@
   const threshold = 0.7;
-  const minConfidence = 50;
+  const minConfidence = 40;
   const maxLookback = 20;
@@ -25,3 +25,3 @@
   function score(input: number): number {
-    return input * 2;
+    return input * 2.5;
   }`;

    const result = convertUnifiedToSearchReplace(unifiedDiff, {});
    expect(result).to.not.be.null;
    const blocks = result!.get('src/instinct/reflexes/pattern-matcher.ts')!;
    // Should produce 2 blocks from 2 hunks
    expect(blocks).to.have.length(2);
    expect(blocks[0].search).to.include('minConfidence = 50');
    expect(blocks[0].replace).to.include('minConfidence = 40');
    expect(blocks[1].search).to.include('return input * 2;');
    expect(blocks[1].replace).to.include('return input * 2.5;');
  });

  it('should return null for empty or invalid diffs', () => {
    expect(convertUnifiedToSearchReplace('', {})).to.be.null;
    expect(convertUnifiedToSearchReplace('just some text', {})).to.be.null;
    expect(convertUnifiedToSearchReplace('no hunks here\nnothing', {})).to.be.null;
  });

  it('should handle context lines correctly', () => {
    const unifiedDiff = `--- a/src/test.ts
+++ b/src/test.ts
@@ -1,5 +1,5 @@
 const a = 1;
 const b = 2;
-const c = 3;
+const c = 33;
 const d = 4;
 const e = 5;`;

    const result = convertUnifiedToSearchReplace(unifiedDiff, {});
    expect(result).to.not.be.null;
    const blocks = result!.get('src/test.ts')!;
    // Context lines should appear in both search and replace
    expect(blocks[0].search).to.include('const a = 1;');
    expect(blocks[0].search).to.include('const c = 3;');
    expect(blocks[0].replace).to.include('const a = 1;');
    expect(blocks[0].replace).to.include('const c = 33;');
  });

  it('should handle additions (no removed lines)', () => {
    const unifiedDiff = `--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;`;

    const result = convertUnifiedToSearchReplace(unifiedDiff, {});
    expect(result).to.not.be.null;
    const blocks = result!.get('src/test.ts')!;
    expect(blocks[0].replace).to.include('const b = 2;');
  });

  it('should handle a real Venice AI style corrupt patch', () => {
    // Simulating the format that caused "corrupt patch at line 29" errors
    const veniceOutput = `--- a/src/instinct/reflexes/pattern-matcher.ts
+++ b/src/instinct/reflexes/pattern-matcher.ts
@@ -324,7 +324,9 @@
   private detectDoubleBottom(candles: Candle[]): PatternResult | null {
     const lookback = this.config.lookbackPeriod;
-    const threshold = 0.02;
+    const threshold = 0.015;
+    // Tighter threshold for more sensitive detection
+    const minVolume = 1000;
     const prices = candles.map(c => c.close);`;

    const result = convertUnifiedToSearchReplace(veniceOutput, {});
    expect(result).to.not.be.null;
    const blocks = result!.get('src/instinct/reflexes/pattern-matcher.ts')!;
    expect(blocks[0].search).to.include('threshold = 0.02');
    expect(blocks[0].replace).to.include('threshold = 0.015');
    expect(blocks[0].replace).to.include('minVolume = 1000');
  });

  it('should track blocks per file for multi-file diffs', () => {
    const unifiedDiff = `--- a/src/alpha.ts
+++ b/src/alpha.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 99;
 const c = 3;
--- a/src/beta.ts
+++ b/src/beta.ts
@@ -5,3 +5,3 @@
 const x = 10;
-const y = 20;
+const y = 42;
 const z = 30;`;

    const result = convertUnifiedToSearchReplace(unifiedDiff, {});
    expect(result).to.not.be.null;
    expect(result!.size).to.equal(2);
    expect(result!.has('src/alpha.ts')).to.be.true;
    expect(result!.has('src/beta.ts')).to.be.true;

    const alphaBlocks = result!.get('src/alpha.ts')!;
    expect(alphaBlocks[0].search).to.include('const b = 2;');
    expect(alphaBlocks[0].replace).to.include('const b = 99;');

    const betaBlocks = result!.get('src/beta.ts')!;
    expect(betaBlocks[0].search).to.include('const y = 20;');
    expect(betaBlocks[0].replace).to.include('const y = 42;');
  });

  it('should skip empty lines (not treat them as context)', () => {
    const unifiedDiff = `--- a/src/test.ts
+++ b/src/test.ts
@@ -1,5 +1,5 @@
 const a = 1;

-const b = 2;
+const b = 3;
 const c = 4;`;

    const result = convertUnifiedToSearchReplace(unifiedDiff, {});
    expect(result).to.not.be.null;
    const blocks = result!.get('src/test.ts')!;
    // The empty line should not bloat the search block
    // Only space-prefixed context, - lines, and + lines should be included
    expect(blocks[0].search).to.not.match(/^\n/);
  });
});
