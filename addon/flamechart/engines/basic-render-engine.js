import { EventEmitter } from '../events.js';
import { getTrianglePoints, mergeObjects } from '../utils.js';
import { defaultPatterns } from '../patterns/default-patterns.js';
// eslint-disable-next-line prettier/prettier -- prettier complains about escaping of the " character
const allChars = 'QWERTYUIOPASDFGHJKLZXCVBNMqwertyuiopasdfghjklzxcvbnm1234567890_-+()[]{}\\/|\'";:.,?~';
const checkSafari = () => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('safari') ? !ua.includes('chrome') : false;
};
function getPixelRatio(context) {
    // Unfortunately using any here, since typescript is not aware of all of the browser prefixes
    const ctx = context;
    const dpr = window.devicePixelRatio || 1;
    const bsr = ctx.webkitBackingStorePixelRatio ||
        ctx.mozBackingStorePixelRatio ||
        ctx.msBackingStorePixelRatio ||
        ctx.oBackingStorePixelRatio ||
        ctx.backingStorePixelRatio ||
        1;
    return dpr / bsr;
}
export const defaultRenderSettings = {
    tooltip: undefined,
    timeUnits: 'ms',
};
export const defaultRenderStyles = {
    blockHeight: 16,
    blockPaddingLeftRight: 4,
    backgroundColor: 'white',
    font: '10px sans-serif',
    fontColor: 'black',
    badgeSize: 8,
    tooltipHeaderFontColor: 'black',
    tooltipBodyFontColor: '#688f45',
    tooltipBackgroundColor: 'white',
    tooltipShadowColor: 'black',
    tooltipShadowBlur: 6,
    tooltipShadowOffsetX: 0,
    tooltipShadowOffsetY: 0,
    headerHeight: 14,
    headerColor: 'rgba(112, 112, 112, 0.25)',
    headerStrokeColor: 'rgba(112, 112, 112, 0.5)',
    headerTitleLeftPadding: 16,
};
export class BasicRenderEngine extends EventEmitter {
    constructor(canvas, settings) {
        super();
        this.options = defaultRenderSettings;
        this.timeUnits = 'ms';
        this.styles = defaultRenderStyles;
        this.blockPaddingLeftRight = 0;
        this.blockHeight = 0;
        this.blockPaddingTopBottom = 0;
        this.charHeight = 0;
        this.placeholderWidth = 0;
        this.avgCharWidth = 0;
        this.minTextWidth = 0;
        this.queue = {};
        this.zoom = 0;
        this.positionX = 0;
        this.min = 0;
        this.max = 0;
        this.patterns = {};
        this.ctxCachedSettings = {};
        this.ctxCachedCalls = {};
        this.setCtxValue = (field, value) => {
            if (this.ctxCachedSettings[field] !== value) {
                this.ctx[field] = value;
                this.ctxCachedSettings[field] = value;
            }
        };
        this.callCtx = (fn, value) => {
            if (!this.ctxCachedCalls[fn] || this.ctxCachedCalls[fn] !== value) {
                this.ctx[fn](value);
                this.ctxCachedCalls[fn] = value;
            }
        };
        this.width = canvas.width;
        this.height = canvas.height;
        this.isSafari = checkSafari();
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.pixelRatio = getPixelRatio(this.ctx);
        this.setSettings(settings);
        this.applyCanvasSize();
        this.reset();
    }
    setSettings({ options, styles, patterns }) {
        this.options = mergeObjects(defaultRenderSettings, options);
        this.styles = mergeObjects(defaultRenderStyles, styles);
        if (patterns) {
            const customPatterns = patterns.filter((preset) => 'creator' in preset);
            const defaultPatterns = patterns.filter((preset) => !('creator' in preset));
            defaultPatterns.forEach((pattern) => this.createDefaultPattern(pattern));
            customPatterns.forEach((pattern) => this.createBlockPattern(pattern));
        }
        this.timeUnits = this.options.timeUnits;
        this.blockHeight = this.styles.blockHeight;
        this.ctx.font = this.styles.font;
        const { actualBoundingBoxAscent: fontAscent, actualBoundingBoxDescent: fontDescent, width: allCharsWidth, } = this.ctx.measureText(allChars);
        const { width: placeholderWidth } = this.ctx.measureText('…');
        const fontHeight = fontAscent + fontDescent;
        this.blockPaddingLeftRight = this.styles.blockPaddingLeftRight;
        this.blockPaddingTopBottom = Math.ceil((this.blockHeight - fontHeight) / 2);
        this.charHeight = fontHeight + 1;
        this.placeholderWidth = placeholderWidth;
        this.avgCharWidth = allCharsWidth / allChars.length;
        this.minTextWidth = this.avgCharWidth + this.placeholderWidth;
    }
    reset() {
        this.queue = {};
        this.ctxCachedCalls = {};
        this.ctxCachedSettings = {};
    }
    setCtxShadow(shadow) {
        var _a, _b;
        this.setCtxValue('shadowBlur', shadow.blur);
        this.setCtxValue('shadowColor', shadow.color);
        this.setCtxValue('shadowOffsetY', (_a = shadow.offsetY) !== null && _a !== void 0 ? _a : 0);
        this.setCtxValue('shadowOffsetX', (_b = shadow.offsetX) !== null && _b !== void 0 ? _b : 0);
    }
    setCtxFont(font) {
        if (font && this.ctx.font !== font) {
            this.ctx.font = font;
        }
    }
    fillRect(x, y, w, h) {
        this.ctx.fillRect(x, y, w, h);
    }
    fillText(text, x, y) {
        this.ctx.fillText(text, x, y);
    }
    renderBlock(x, y, w, h) {
        const truncatedX = Math.min(this.width, Math.max(0, x));
        const delta = truncatedX - x;
        const width = Math.min(this.width - truncatedX, Math.max(0, w - delta));
        this.ctx.fillRect(truncatedX, y, width, h !== null && h !== void 0 ? h : this.blockHeight);
    }
    renderStroke(color, x, y, w, h) {
        this.setCtxValue('strokeStyle', color);
        this.ctx.setLineDash([]);
        this.ctx.strokeRect(x, y, w, h);
    }
    clear(w = this.width, h = this.height, x = 0, y = 0) {
        this.setCtxValue('fillStyle', this.styles.backgroundColor);
        this.ctx.clearRect(x, y, w, h - 1);
        this.ctx.fillRect(x, y, w, h);
        this.ctxCachedCalls = {};
        this.ctxCachedSettings = {};
        this.emit('clear');
    }
    timeToPosition(time) {
        return time * this.zoom - this.positionX * this.zoom;
    }
    pixelToTime(width) {
        return width / this.zoom;
    }
    setZoom(zoom) {
        this.zoom = zoom;
    }
    setPositionX(x) {
        const currentPos = this.positionX;
        this.positionX = x;
        return x - currentPos;
    }
    getQueue(priority = 0) {
        const queue = this.queue[priority];
        if (!queue) {
            this.queue[priority] = { text: [], stroke: [], rect: {} };
        }
        return this.queue[priority];
    }
    addRect(rect, priority = 0) {
        const queue = this.getQueue(priority);
        rect.pattern = rect.pattern || 'none';
        if (!queue.rect[rect.pattern]) {
            queue.rect[rect.pattern] = {};
        }
        if (!queue.rect[rect.pattern][rect.color]) {
            queue.rect[rect.pattern][rect.color] = [];
        }
        queue.rect[rect.pattern][rect.color].push(rect);
    }
    addText({ text, x, y, w }, priority = 0) {
        if (text) {
            const textMaxWidth = w - (this.blockPaddingLeftRight * 2 - (x < 0 ? x : 0));
            if (textMaxWidth > 0) {
                const queue = this.getQueue(priority);
                queue.text.push({ text, x, y, w, textMaxWidth });
            }
        }
    }
    addStroke(stroke, priority = 0) {
        const queue = this.getQueue(priority);
        queue.stroke.push(stroke);
    }
    resolveQueue() {
        Object.keys(this.queue)
            .map((priority) => parseInt(priority))
            .sort()
            .forEach((priority) => {
            const { rect, text, stroke } = this.queue[priority];
            this.renderRects(rect);
            this.renderTexts(text);
            this.renderStrokes(stroke);
        });
        this.queue = {};
    }
    renderRects(rects) {
        Object.entries(rects).forEach(([patternName, colors]) => {
            let matrix = new DOMMatrixReadOnly();
            let pattern;
            if (patternName !== 'none' && this.patterns[patternName]) {
                pattern = this.patterns[patternName];
                if (pattern.scale !== 1) {
                    matrix = matrix.scale(1 / pattern.scale, 1 / pattern.scale);
                }
                this.ctx.fillStyle = pattern.pattern;
                this.ctxCachedSettings['fillStyle'] = patternName;
            }
            Object.entries(colors).forEach(([color, items]) => {
                if (!pattern) {
                    this.setCtxValue('fillStyle', color);
                }
                items.forEach((rect) => {
                    if (pattern) {
                        const fullDeltaX = rect.x * pattern.scale;
                        const deltaX = fullDeltaX - Math.floor(fullDeltaX / pattern.width) * pattern.width;
                        pattern.pattern.setTransform(matrix.translate(deltaX, rect.y * pattern.scale));
                    }
                    this.renderBlock(rect.x, rect.y, rect.w, rect.h);
                });
            });
        });
    }
    renderTexts(texts) {
        this.setCtxValue('fillStyle', this.styles.fontColor);
        texts.forEach(({ text, x, y, textMaxWidth }) => {
            const { width: textWidth } = this.ctx.measureText(text);
            if (textWidth > textMaxWidth) {
                const avgCharWidth = textWidth / text.length;
                const maxChars = Math.floor((textMaxWidth - this.placeholderWidth) / avgCharWidth);
                const halfChars = (maxChars - 1) / 2;
                if (halfChars > 0) {
                    text =
                        text.slice(0, Math.ceil(halfChars)) +
                            '…' +
                            text.slice(text.length - Math.floor(halfChars), text.length);
                }
                else {
                    text = '';
                }
            }
            if (text) {
                this.ctx.fillText(text, (x < 0 ? 0 : x) + this.blockPaddingLeftRight, y + this.blockHeight - this.blockPaddingTopBottom);
            }
        });
    }
    renderStrokes(strokes) {
        strokes.forEach(({ color, x, y, w, h }) => {
            this.renderStroke(color, x, y, w, h);
        });
    }
    setMinMax(min, max) {
        const hasChanges = min !== this.min || max !== this.max;
        this.min = min;
        this.max = max;
        if (hasChanges) {
            this.emit('min-max-change', min, max);
        }
    }
    getTimeUnits() {
        return this.timeUnits;
    }
    tryToChangePosition(positionDelta) {
        const realView = this.getRealView();
        if (this.positionX + positionDelta + realView <= this.max && this.positionX + positionDelta >= this.min) {
            this.setPositionX(this.positionX + positionDelta);
        }
        else if (this.positionX + positionDelta <= this.min) {
            this.setPositionX(this.min);
        }
        else if (this.positionX + positionDelta + realView >= this.max) {
            this.setPositionX(this.max - realView);
        }
    }
    getInitialZoom() {
        if (this.max - this.min > 0) {
            return this.width / (this.max - this.min);
        }
        return 1;
    }
    getRealView() {
        return this.width / this.zoom;
    }
    resetView() {
        this.setZoom(this.getInitialZoom());
        this.setPositionX(this.min);
    }
    resize(width, height) {
        const resolvedWidth = Math.max(0, width || 0);
        const resolvedHeight = Math.max(0, height || 0);
        const isWidthChanged = typeof width === 'number' && this.width !== resolvedWidth;
        const isHeightChanged = typeof height === 'number' && this.height !== resolvedHeight;
        if (isWidthChanged || isHeightChanged) {
            this.width = isWidthChanged ? resolvedWidth : this.width;
            this.height = isHeightChanged ? resolvedHeight : this.height;
            this.applyCanvasSize();
            this.emit('resize', { width: this.width, height: this.height });
            return isHeightChanged;
        }
        return false;
    }
    applyCanvasSize() {
        this.canvas.style.backgroundColor = 'white';
        this.canvas.style.overflow = 'hidden';
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.canvas.width = this.width * this.pixelRatio;
        this.canvas.height = this.height * this.pixelRatio;
        this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
        this.ctx.font = this.styles.font;
    }
    copy(engine) {
        const ratio = this.isSafari ? 1 : engine.pixelRatio;
        if (engine.canvas.height) {
            this.ctx.drawImage(engine.canvas, 0, 0, engine.canvas.width * ratio, engine.canvas.height * ratio, 0, engine.position || 0, engine.width * ratio, engine.height * ratio);
        }
    }
    createDefaultPattern({ name, type, config }) {
        const defaultPattern = defaultPatterns[type];
        if (defaultPattern) {
            this.createBlockPattern({
                name,
                creator: defaultPattern(config),
            });
        }
    }
    createCachedDefaultPattern(pattern) {
        if (!this.patterns[pattern.name]) {
            this.createDefaultPattern(pattern);
        }
    }
    createBlockPattern({ name, creator }) {
        this.patterns[name] = {
            scale: 1,
            width: 10,
            ...creator(this),
        };
    }
    renderTooltipFromData(fields, mouse) {
        const mouseX = mouse.x + 10;
        const mouseY = mouse.y + 10;
        const maxWidth = fields
            .map(({ text }) => text)
            .map((text) => this.ctx.measureText(text))
            .reduce((acc, { width }) => Math.max(acc, width), 0);
        const fullWidth = maxWidth + this.blockPaddingLeftRight * 2;
        this.setCtxShadow({
            color: this.styles.tooltipShadowColor,
            blur: this.styles.tooltipShadowBlur,
            offsetX: this.styles.tooltipShadowOffsetX,
            offsetY: this.styles.tooltipShadowOffsetY,
        });
        this.setCtxValue('fillStyle', this.styles.tooltipBackgroundColor);
        this.ctx.fillRect(mouseX, mouseY, fullWidth + this.blockPaddingLeftRight * 2, (this.charHeight + 2) * fields.length + this.blockPaddingLeftRight * 2);
        this.setCtxShadow({
            color: 'transparent',
            blur: 0,
        });
        fields.forEach(({ text, color }, index) => {
            if (color) {
                this.setCtxValue('fillStyle', color);
            }
            else if (!index) {
                this.setCtxValue('fillStyle', this.styles.tooltipHeaderFontColor);
            }
            else {
                this.setCtxValue('fillStyle', this.styles.tooltipBodyFontColor);
            }
            this.ctx.fillText(text, mouseX + this.blockPaddingLeftRight, mouseY + this.blockHeight - this.blockPaddingTopBottom + (this.charHeight + 2) * index);
        });
    }
    renderShape(color, dots, posX, posY) {
        this.setCtxValue('fillStyle', color);
        this.ctx.beginPath();
        this.ctx.moveTo(dots[0].x + posX, dots[0].y + posY);
        dots.slice(1).forEach(({ x, y }) => this.ctx.lineTo(x + posX, y + posY));
        this.ctx.closePath();
        this.ctx.fill();
    }
    renderTriangle({ color, x, y, width, height, direction, }) {
        this.renderShape(color, getTrianglePoints(width, height, direction), x, y);
    }
    renderCircle(color, x, y, radius) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
        this.setCtxValue('fillStyle', color);
        this.ctx.fill();
    }
}
