import { BasicRenderEngine } from './basic-render-engine.js';
import { OffscreenRenderEngine } from './offscreen-render-engine.js';
import { isNumber } from '../utils.js';
const MAX_ACCURACY = 6;
export class RenderEngine extends BasicRenderEngine {
    constructor({ canvas, settings, timeGrid, plugins }) {
        super(canvas, settings);
        this.freeSpace = 0;
        this.lastPartialAnimationFrame = null;
        this.lastGlobalAnimationFrame = null;
        this.plugins = plugins;
        this.children = [];
        this.requestedRenders = [];
        this.timeGrid = timeGrid;
        this.timeGrid.setDefaultRenderEngine(this);
    }
    makeInstance() {
        const offscreenRenderEngine = new OffscreenRenderEngine({
            width: this.width,
            height: 0,
            id: this.children.length,
            parent: this,
        });
        offscreenRenderEngine.setMinMax(this.min, this.max);
        offscreenRenderEngine.resetView();
        this.children.push(offscreenRenderEngine);
        return offscreenRenderEngine;
    }
    calcMinMax() {
        const mins = this.plugins.map(({ min }) => min).filter(isNumber);
        const min = mins.length ? mins.reduce((acc, min) => Math.min(acc, min)) : 0;
        const maxs = this.plugins.map(({ max }) => max).filter(isNumber);
        const max = maxs.length ? maxs.reduce((acc, max) => Math.max(acc, max)) : 0;
        this.setMinMax(min, max);
    }
    calcTimeGrid() {
        this.timeGrid.recalc();
    }
    setMinMax(min, max) {
        super.setMinMax(min, max);
        this.children.forEach((engine) => engine.setMinMax(min, max));
    }
    setSettings(data) {
        super.setSettings(data);
        if (this.children) {
            this.children.forEach((engine) => engine.setSettings(data));
            this.recalcChildrenLayout();
        }
    }
    resize(width, height) {
        const currentWidth = this.width;
        super.resize(width, height);
        this.recalcChildrenLayout();
        if (this.getInitialZoom() > this.zoom) {
            this.resetView();
        }
        else if (this.positionX > this.min) {
            this.tryToChangePosition(-this.pixelToTime((width - currentWidth) / 2));
        }
        return true;
    }
    recalcChildrenLayout() {
        const childrenLayout = this.getChildrenLayout();
        if (childrenLayout.freeSpace > 0) {
            this.expandGrowingChildrenLayout(childrenLayout);
        }
        else if (childrenLayout.freeSpace < 0) {
            this.truncateChildrenLayout(childrenLayout);
        }
        this.freeSpace = childrenLayout.freeSpace;
        this.children.forEach((engine, index) => {
            engine.resize(childrenLayout.placements[index], true);
        });
    }
    getChildrenLayout() {
        return this.children.reduce((acc, engine, index) => {
            var _a;
            const plugin = this.plugins[index];
            const pluginHeight = plugin.fullHeight;
            let type = 'static';
            let height = 0;
            if (engine.flexible && typeof plugin.height === 'number') {
                type = 'flexibleStatic';
            }
            else if (plugin.height === 'flexible') {
                type = 'flexibleGrowing';
            }
            if (engine.collapsed) {
                height = 0;
            }
            else {
                switch (type) {
                    case 'static':
                        height = pluginHeight;
                        break;
                    case 'flexibleGrowing':
                        height = engine.height || 0;
                        break;
                    case 'flexibleStatic':
                        height = (_a = (engine.height || pluginHeight)) !== null && _a !== void 0 ? _a : 0;
                        break;
                }
            }
            acc.placements.push({
                width: this.width,
                position: acc.position,
                height,
                type,
            });
            acc.position += height;
            acc.freeSpace -= height;
            return acc;
        }, {
            position: 0,
            placements: [],
            freeSpace: this.height,
        });
    }
    expandGrowingChildrenLayout(childrenLayout) {
        const { placements, freeSpace } = childrenLayout;
        const last = placements[placements.length - 1];
        const growingChildren = placements.map(({ type, height }, index) => type === 'flexibleGrowing' && !this.children[index].collapsed && height === 0);
        const growingChildrenCount = growingChildren.filter(Boolean).length;
        if (growingChildrenCount) {
            const vacantSpacePart = Math.max(0, Math.floor(freeSpace / growingChildrenCount));
            growingChildren.forEach((isGrowing, index) => {
                if (isGrowing) {
                    placements[index].height += vacantSpacePart;
                    childrenLayout.freeSpace -= vacantSpacePart;
                    for (let nextIndex = index + 1; nextIndex < placements.length; nextIndex++) {
                        placements[nextIndex].position += vacantSpacePart;
                    }
                }
            });
        }
        if (last.type === 'flexibleGrowing' && !this.children[this.children.length - 1].collapsed) {
            last.height = Math.max(0, this.height - last.position);
            childrenLayout.freeSpace = 0;
        }
        return childrenLayout;
    }
    truncateChildrenLayout(childrenLayout) {
        const { placements, freeSpace } = childrenLayout;
        let diff = Math.abs(freeSpace);
        while (diff > 0) {
            const lastFlexibleIndex = placements.findLastIndex(({ height, type }) => height > 0 && type !== 'static');
            if (lastFlexibleIndex !== -1) {
                const size = placements[lastFlexibleIndex];
                const newHeight = Math.max(0, size.height - diff);
                const delta = size.height - newHeight;
                size.height = newHeight;
                diff -= delta;
                childrenLayout.freeSpace += delta;
                placements.forEach((size, index) => {
                    if (index > lastFlexibleIndex) {
                        size.position -= delta;
                    }
                });
            }
        }
        return childrenLayout;
    }
    getAccuracy() {
        return this.timeGrid.accuracy;
    }
    setZoom(zoom) {
        if (this.getAccuracy() < MAX_ACCURACY || zoom <= this.zoom) {
            const resolvedZoom = Math.max(zoom, this.getInitialZoom());
            if (resolvedZoom !== this.zoom) {
                super.setZoom(resolvedZoom);
                this.children.forEach((engine) => engine.setZoom(resolvedZoom));
                return true;
            }
        }
        return false;
    }
    setPositionX(x) {
        const res = super.setPositionX(x);
        this.children.forEach((engine) => engine.setPositionX(x));
        return res;
    }
    renderPlugin(index) {
        var _a;
        const plugin = this.plugins[index];
        const engine = this.children[index];
        engine === null || engine === void 0 ? void 0 : engine.clear();
        if (!engine.collapsed) {
            const isFullRendered = (_a = plugin === null || plugin === void 0 ? void 0 : plugin.render) === null || _a === void 0 ? void 0 : _a.call(plugin);
            if (!isFullRendered) {
                engine.standardRender();
            }
        }
    }
    partialRender(id) {
        if (typeof id === 'number') {
            this.requestedRenders.push(id);
        }
        if (!this.lastPartialAnimationFrame) {
            this.lastPartialAnimationFrame = requestAnimationFrame(() => {
                this.requestedRenders.forEach((index) => this.renderPlugin(index));
                this.shallowRender();
                this.requestedRenders = [];
                this.lastPartialAnimationFrame = null;
            });
        }
    }
    shallowRender() {
        this.clear();
        this.timeGrid.renderLines(this.height - this.freeSpace, this.freeSpace);
        this.children.forEach((engine) => {
            if (!engine.collapsed) {
                this.copy(engine);
            }
        });
        let tooltipRendered = false;
        this.plugins.forEach((plugin) => {
            if (plugin.postRender) {
                plugin.postRender();
            }
        });
        this.plugins.forEach((plugin) => {
            if (plugin.renderTooltip) {
                tooltipRendered = tooltipRendered || Boolean(plugin.renderTooltip());
            }
        });
        if (!tooltipRendered && typeof this.options.tooltip === 'function') {
            // notify tooltip of nothing to render
            this.options.tooltip(null, this, null);
        }
    }
    render(prepare) {
        if (typeof this.lastPartialAnimationFrame === 'number') {
            cancelAnimationFrame(this.lastPartialAnimationFrame);
        }
        this.requestedRenders = [];
        this.lastPartialAnimationFrame = null;
        const prevFrameTime = performance.now();
        if (!this.lastGlobalAnimationFrame) {
            this.lastGlobalAnimationFrame = requestAnimationFrame(() => {
                this.lastGlobalAnimationFrame = null;
                prepare === null || prepare === void 0 ? void 0 : prepare(performance.now() - prevFrameTime);
                this.timeGrid.recalc();
                this.children.forEach((_, index) => this.renderPlugin(index));
                this.shallowRender();
            });
        }
    }
}
