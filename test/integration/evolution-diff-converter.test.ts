import { expect } from 'chai';
import { convertUnifiedToSearchReplace } from '../../src/evolution/sandbox';

describe('Evolution Diff Converter', () => {
  it('should convert a simple unified diff to SEARCH/REPLACE', () => {
    const unifiedDiff = `--- a/src/agent/circuit-breaker.ts
+++ b/src/agent/circuit-breaker.ts
@@ -133,7 +133,7 @@
   private checkThreshold(value: number): boolean {
-    return value > 0.5;
+    return value > 0.3;
   }`;

    const result = convertUnifiedToSearchReplace(unifiedDiff, {});
    expect(result).to.not.be.null;
    expect(result).to.include('<<<<<<< SEARCH');
    expect(result).to.include('>>>>>>> REPLACE');
    expect(result).to.include('return value > 0.5;');
    expect(result).to.include('return value > 0.3;');
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
    // Should produce 2 SEARCH/REPLACE blocks
    const blocks = result!.match(/<<<<<<< SEARCH/g);
    expect(blocks).to.have.length(2);
    expect(result).to.include('minConfidence = 50');
    expect(result).to.include('minConfidence = 40');
    expect(result).to.include('return input * 2;');
    expect(result).to.include('return input * 2.5;');
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
    // Context lines should appear in both SEARCH and REPLACE
    expect(result).to.include('const a = 1;');
    expect(result).to.include('const c = 3;');
    expect(result).to.include('const c = 33;');
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
    expect(result).to.include('<<<<<<< SEARCH');
    expect(result).to.include('const b = 2;');
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
    expect(result).to.include('threshold = 0.02');
    expect(result).to.include('threshold = 0.015');
    expect(result).to.include('minVolume = 1000');
  });
});
