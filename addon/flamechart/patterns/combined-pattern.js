import { createPatternCanvas } from './utils.js';
import { stripesPattern } from './stripes-pattern.js';
import { dotsPattern } from './dots-pattern.js';
import { gradientPattern } from './gradient-pattern.js';
import { trianglesPattern } from './triangles-pattern.js';
const combinedPatterns = {
    stripes: stripesPattern,
    dots: dotsPattern,
    gradient: gradientPattern,
    triangles: trianglesPattern,
};
function findMinIntegerWidth(arr, max = Infinity) {
    const maxNumber = Math.max(...arr);
    if (arr.every((n) => maxNumber % n === 0)) {
        return maxNumber;
    }
    let num = 1;
    while (num < max) {
        let isDivisor = true;
        for (let i = 0; i < arr.length; i++) {
            if (num % arr[i] !== 0) {
                isDivisor = false;
                break;
            }
        }
        if (isDivisor) {
            return num;
        }
        num++;
    }
    return max;
}
export const combinedPattern = (patterns) => (engine) => {
    const { ctx, canvas } = createPatternCanvas();
    const scale = 4;
    const renderedPatterns = patterns.map((pattern) => {
        if ('creator' in pattern) {
            return pattern.creator(engine);
        }
        return combinedPatterns[pattern.type](pattern.config)(engine);
    });
    const height = engine.blockHeight * scale;
    const width = findMinIntegerWidth(renderedPatterns.map(({ width = 1, scale: patternScale = 1 }) => width * (scale / patternScale)), engine.width * scale);
    const maxScale = Math.max(...renderedPatterns.map((pattern) => pattern.scale || 1));
    ctx.setTransform(maxScale, 0, 0, maxScale, 0, 0);
    canvas.height = height;
    canvas.width = width;
    renderedPatterns.forEach(({ scale: patternScale = 1, pattern }) => {
        ctx.fillStyle = pattern;
        pattern.setTransform(new DOMMatrixReadOnly().scale(scale / patternScale, scale / patternScale));
        ctx.fillRect(0, 0, width, height);
    });
    const pattern = engine.ctx.createPattern(canvas, 'repeat');
    return {
        pattern,
        width,
        scale,
    };
};
