import { clusterizeFlatTree, flatTree, getFlatTreeMinMax, metaClusterizeFlatTree, reclusterizeClusteredFlatTree, } from './utils/tree-clusters.js';
import Color from '../color.js';
import UIPlugin from './ui-plugin.js';
const DEFAULT_COLOR = Color.hsl(180, 30, 70);
export class FlameChartPlugin extends UIPlugin {
    constructor({ data, colors = {}, name = 'flameChartPlugin', }) {
        super(name);
        this.height = 'flexible';
        this.flatTree = [];
        this.positionY = 0;
        this.colors = {};
        this.selectedRegion = null;
        this.hoveredRegion = null;
        this.lastRandomColor = DEFAULT_COLOR;
        this.metaClusterizedFlatTree = [];
        this.actualClusterizedFlatTree = [];
        this.initialClusterizedFlatTree = [];
        this.lastUsedColor = null;
        this.renderChartTimeout = -1;
        this.data = data;
        this.userColors = colors;
        this.parseData();
        this.reset();
    }
    init(renderEngine, interactionsEngine) {
        super.init(renderEngine, interactionsEngine);
        this.interactionsEngine.on('change-position', this.handlePositionChange.bind(this));
        this.interactionsEngine.on('select', this.handleSelect.bind(this));
        this.interactionsEngine.on('hover', this.handleHover.bind(this));
        this.interactionsEngine.on('up', this.handleMouseUp.bind(this));
        this.initData();
    }
    handlePositionChange({ deltaX, deltaY }) {
        const startPositionY = this.positionY;
        const startPositionX = this.renderEngine.parent.positionX;
        this.interactionsEngine.setCursor('grabbing');
        if (this.positionY + deltaY >= 0) {
            this.setPositionY(this.positionY + deltaY);
        }
        else {
            this.setPositionY(0);
        }
        this.renderEngine.tryToChangePosition(deltaX);
        if (startPositionX !== this.renderEngine.parent.positionX || startPositionY !== this.positionY) {
            this.renderEngine.parent.render();
        }
    }
    handleMouseUp() {
        this.interactionsEngine.clearCursor();
    }
    setPositionY(y) {
        this.positionY = y;
    }
    reset() {
        this.colors = {};
        this.lastRandomColor = DEFAULT_COLOR;
        this.positionY = 0;
        this.selectedRegion = null;
    }
    calcMinMax() {
        const { flatTree } = this;
        const { min, max } = getFlatTreeMinMax(flatTree);
        this.min = min;
        this.max = max;
    }
    handleSelect(region) {
        var _a, _b;
        const selectedRegion = this.findNodeInCluster(region);
        if (this.selectedRegion !== selectedRegion) {
            this.selectedRegion = selectedRegion;
            this.renderEngine.render();
            this.emit('select', { node: (_b = (_a = this.selectedRegion) === null || _a === void 0 ? void 0 : _a.data) !== null && _b !== void 0 ? _b : null, type: 'flame-chart-node' });
        }
    }
    handleHover(region) {
        this.hoveredRegion = this.findNodeInCluster(region);
    }
    findNodeInCluster(region) {
        const mouse = this.interactionsEngine.getMouse();
        if (region && region.type === "cluster" /* RegionTypes.CLUSTER */) {
            const hoveredNode = region.data.nodes.find(({ level, source: { start, duration } }) => {
                const { x, y, w } = this.calcRect(start, duration, level);
                return mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + this.renderEngine.blockHeight;
            });
            if (hoveredNode) {
                return {
                    data: hoveredNode,
                    type: 'node',
                };
            }
        }
        return null;
    }
    getColor(type = '_default', defaultColor) {
        if (defaultColor) {
            return defaultColor;
        }
        else if (this.colors[type]) {
            return this.colors[type];
        }
        else if (this.userColors[type]) {
            const color = new Color(this.userColors[type]);
            this.colors[type] = color.rgb().toString();
            return this.colors[type];
        }
        this.lastRandomColor = this.lastRandomColor.rotate(27);
        this.colors[type] = this.lastRandomColor.rgb().toString();
        return this.colors[type];
    }
    setData(data) {
        this.data = data;
        this.parseData();
        this.initData();
        this.reset();
        this.renderEngine.recalcMinMax();
        this.renderEngine.resetParentView();
    }
    parseData() {
        this.flatTree = flatTree(this.data);
        this.calcMinMax();
    }
    initData() {
        this.metaClusterizedFlatTree = metaClusterizeFlatTree(this.flatTree);
        this.initialClusterizedFlatTree = clusterizeFlatTree(this.metaClusterizedFlatTree, this.renderEngine.zoom, this.min, this.max);
        this.reclusterizeClusteredFlatTree();
    }
    reclusterizeClusteredFlatTree() {
        this.actualClusterizedFlatTree = reclusterizeClusteredFlatTree(this.initialClusterizedFlatTree, this.renderEngine.zoom, this.renderEngine.positionX, this.renderEngine.positionX + this.renderEngine.getRealView());
    }
    calcRect(start, duration, level) {
        const w = duration * this.renderEngine.zoom;
        return {
            x: this.renderEngine.timeToPosition(start),
            y: level * (this.renderEngine.blockHeight + 1) - this.positionY,
            w: w <= 0.1 ? 0.1 : w >= 3 ? w - 1 : w - w / 3,
        };
    }
    renderTooltip() {
        if (this.hoveredRegion) {
            if (this.renderEngine.options.tooltip === false) {
                return true;
            }
            else if (typeof this.renderEngine.options.tooltip === 'function') {
                this.renderEngine.options.tooltip(this.hoveredRegion, this.renderEngine, this.interactionsEngine.getGlobalMouse());
            }
            else {
                const { data: { source: { start, duration, name, children }, }, } = this.hoveredRegion;
                const timeUnits = this.renderEngine.getTimeUnits();
                const selfTime = duration - (children ? children.reduce((acc, { duration }) => acc + duration, 0) : 0);
                const nodeAccuracy = this.renderEngine.getAccuracy() + 2;
                const header = `${name}`;
                const dur = `duration: ${duration.toFixed(nodeAccuracy)} ${timeUnits} ${(children === null || children === void 0 ? void 0 : children.length) ? `(self ${selfTime.toFixed(nodeAccuracy)} ${timeUnits})` : ''}`;
                const st = `start: ${start.toFixed(nodeAccuracy)}`;
                this.renderEngine.renderTooltipFromData([{ text: header }, { text: dur }, { text: st }], this.interactionsEngine.getGlobalMouse());
            }
            return true;
        }
        return false;
    }
    render() {
        const { width, blockHeight, height, minTextWidth } = this.renderEngine;
        this.lastUsedColor = null;
        this.reclusterizeClusteredFlatTree();
        const processCluster = (cb) => {
            return (cluster) => {
                const { start, duration, level } = cluster;
                const { x, y, w } = this.calcRect(start, duration, level);
                if (x + w > 0 && x < width && y + blockHeight > 0 && y < height) {
                    cb(cluster, x, y, w);
                }
            };
        };
        const renderCluster = (cluster, x, y, w) => {
            const { type, nodes, color, pattern, badge } = cluster;
            const mouse = this.interactionsEngine.getMouse();
            if (mouse.y >= y && mouse.y <= y + blockHeight) {
                addHitRegion(cluster, x, y, w);
            }
            if (w >= 0.25) {
                this.renderEngine.addRect({ color: this.getColor(type, color), pattern, x, y, w }, 0);
                if (badge) {
                    const badgePatternName = `node-badge-${badge}`;
                    const badgeWidth = (this.renderEngine.styles.badgeSize * 2) / Math.SQRT2;
                    this.renderEngine.createCachedDefaultPattern({
                        name: badgePatternName,
                        type: 'triangles',
                        config: {
                            color: badge,
                            width: badgeWidth,
                            align: 'top',
                            direction: 'top-left',
                        },
                    });
                    this.renderEngine.addRect({
                        pattern: badgePatternName,
                        color: 'transparent',
                        x,
                        y,
                        w: Math.min(badgeWidth, w),
                    }, 1);
                }
            }
            if (w >= minTextWidth && nodes.length === 1) {
                this.renderEngine.addText({ text: nodes[0].source.name, x, y, w }, 2);
            }
        };
        const addHitRegion = (cluster, x, y, w) => {
            this.interactionsEngine.addHitRegion("cluster" /* RegionTypes.CLUSTER */, cluster, x, y, w, blockHeight);
        };
        this.actualClusterizedFlatTree.forEach(processCluster(renderCluster));
        if (this.selectedRegion && this.selectedRegion.type === 'node') {
            const { source: { start, duration }, level, } = this.selectedRegion.data;
            const { x, y, w } = this.calcRect(start, duration, level);
            this.renderEngine.addStroke({ color: 'green', x, y, w, h: this.renderEngine.blockHeight }, 2);
        }
        clearTimeout(this.renderChartTimeout);
        this.renderChartTimeout = window.setTimeout(() => {
            this.interactionsEngine.clearHitRegions();
            this.actualClusterizedFlatTree.forEach(processCluster(addHitRegion));
        }, 16);
    }
}
