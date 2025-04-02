import { mergeObjects } from '../utils.js';
import { BasicRenderEngine } from './basic-render-engine.js';
export class OffscreenRenderEngine extends BasicRenderEngine {
    constructor({ width, height, parent, id }) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        super(canvas, { options: parent.options, styles: parent.styles });
        this.flexible = false;
        this.collapsed = false;
        this.position = 0;
        this.savedHeight = null;
        this.width = width;
        this.height = height;
        this.parent = parent;
        this.id = id;
        this.children = [];
        this.applyCanvasSize();
    }
    makeChild() {
        const child = new OffscreenRenderEngine({
            width: this.width,
            height: this.height,
            parent: this.parent,
            id: void 0,
        });
        this.children.push(child);
        child.setMinMax(this.min, this.max);
        child.resetView();
        return child;
    }
    setFlexible() {
        this.flexible = true;
    }
    collapse() {
        this.collapsed = true;
        this.savedHeight = this.height;
        this.clear();
    }
    expand() {
        this.collapsed = false;
        if (this.savedHeight) {
            this.resize({ height: this.savedHeight });
        }
    }
    setSettingsOverrides(settings) {
        this.setSettings({
            styles: mergeObjects(this.styles, settings.styles),
            options: mergeObjects(this.options, settings.options),
        });
        this.children.forEach((child) => child.setSettingsOverrides(settings));
    }
    // @ts-ignore - overrides a parent function which has different signature
    resize({ width, height, position }, isParentCall) {
        const isHeightChanged = super.resize(width, height);
        if ((height !== null && height !== void 0 ? height : 0) <= 0) {
            this.collapsed = true;
        }
        if (!isParentCall && isHeightChanged) {
            this.parent.recalcChildrenLayout();
        }
        if (typeof position === 'number') {
            this.position = position;
        }
        this.children.forEach((child) => child.resize({ width, height, position }));
    }
    setMinMax(min, max) {
        super.setMinMax(min, max);
        this.children.forEach((child) => child.setMinMax(min, max));
    }
    setSettings(settings) {
        super.setSettings(settings);
        if (this.children) {
            this.children.forEach((child) => child.setSettings(settings));
        }
    }
    tryToChangePosition(positionDelta) {
        this.parent.tryToChangePosition(positionDelta);
    }
    recalcMinMax() {
        this.parent.calcMinMax();
    }
    getTimeUnits() {
        return this.parent.getTimeUnits();
    }
    getAccuracy() {
        return this.parent.timeGrid.accuracy;
    }
    renderTimeGrid() {
        this.parent.timeGrid.renderLines(0, this.height, this);
    }
    renderTimeGridTimes() {
        this.parent.timeGrid.renderTimes(this);
    }
    standardRender() {
        this.resolveQueue();
        this.renderTimeGrid();
    }
    renderTooltipFromData(fields, mouse) {
        this.parent.renderTooltipFromData(fields, mouse);
    }
    resetParentView() {
        this.parent.resetView();
        this.parent.render();
    }
    render() {
        this.parent.partialRender(this.id);
    }
}
