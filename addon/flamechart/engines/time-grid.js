import { mergeObjects } from '../utils.js';
const MIN_PIXEL_DELTA = 85;
export const defaultTimeGridStyles = {
    color: 'rgba(90,90,90,0.20)',
};
export class TimeGrid {
    constructor(settings) {
        this.styles = defaultTimeGridStyles;
        this.timeUnits = 'ms';
        this.start = 0;
        this.end = 0;
        this.accuracy = 0;
        this.delta = 0;
        this.setSettings(settings);
    }
    setDefaultRenderEngine(renderEngine) {
        this.renderEngine = renderEngine;
        this.timeUnits = this.renderEngine.getTimeUnits();
    }
    setSettings({ styles }) {
        this.styles = mergeObjects(defaultTimeGridStyles, styles);
        if (this.renderEngine) {
            this.timeUnits = this.renderEngine.getTimeUnits();
        }
    }
    recalc() {
        const timeWidth = this.renderEngine.max - this.renderEngine.min;
        const initialLinesCount = this.renderEngine.width / MIN_PIXEL_DELTA;
        const initialTimeLineDelta = timeWidth / initialLinesCount;
        const realView = this.renderEngine.getRealView();
        const proportion = realView / (timeWidth || 1);
        this.delta = initialTimeLineDelta / Math.pow(2, Math.floor(Math.log2(1 / proportion)));
        this.start = Math.floor((this.renderEngine.positionX - this.renderEngine.min) / this.delta);
        this.end = Math.ceil(realView / this.delta) + this.start;
        this.accuracy = this.calcNumberFix();
    }
    calcNumberFix() {
        var _a;
        const strTimelineDelta = (this.delta / 2).toString();
        if (strTimelineDelta.includes('e')) {
            return Number((_a = strTimelineDelta.match(/\d+$/)) === null || _a === void 0 ? void 0 : _a[0]);
        }
        const zeros = strTimelineDelta.match(/(0\.0*)/);
        return zeros ? zeros[0].length - 1 : 0;
    }
    getTimelineAccuracy() {
        return this.accuracy;
    }
    forEachTime(cb) {
        if (Number.isFinite(this.start) && Number.isFinite(this.end)) {
            for (let i = this.start; i <= this.end; i++) {
                const timePosition = i * this.delta + this.renderEngine.min;
                const pixelPosition = this.renderEngine.timeToPosition(Number(timePosition.toFixed(this.accuracy)));
                cb(pixelPosition, timePosition);
            }
        }
    }
    renderLines(start, height, renderEngine = this.renderEngine) {
        renderEngine.setCtxValue('fillStyle', this.styles.color);
        this.forEachTime((pixelPosition) => {
            renderEngine.fillRect(pixelPosition, start, 1, height);
        });
    }
    renderTimes(renderEngine = this.renderEngine) {
        renderEngine.setCtxValue('fillStyle', renderEngine.styles.fontColor);
        renderEngine.setCtxFont(renderEngine.styles.font);
        this.forEachTime((pixelPosition, timePosition) => {
            renderEngine.fillText(timePosition.toFixed(this.accuracy) + this.timeUnits, pixelPosition + renderEngine.blockPaddingLeftRight, renderEngine.charHeight);
        });
    }
}
