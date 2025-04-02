import { clusterizeFlatTree, flatTree, getFlatTreeMinMax, metaClusterizeFlatTree, reclusterizeClusteredFlatTree, } from './utils/tree-clusters.js';
import { mergeObjects } from '../utils.js';
import { TimeGrid } from '../engines/time-grid.js';
import UIPlugin from './ui-plugin.js';
import { getMinMax, renderChart, } from './utils/chart-render.js';
const TIMEFRAME_STICK_DISTANCE = 2;
export const defaultTimeframeSelectorPluginStyles = {
    font: '9px sans-serif',
    fontColor: 'black',
    overlayColor: 'rgba(112, 112, 112, 0.5)',
    graphStrokeColor: 'rgba(0, 0, 0, 0.10)',
    graphFillColor: 'rgba(0, 0, 0, 0.15)',
    flameChartGraphType: 'smooth',
    bottomLineColor: 'rgba(0, 0, 0, 0.25)',
    knobColor: 'rgb(131, 131, 131)',
    knobStrokeColor: 'white',
    knobSize: 6,
    height: 60,
    backgroundColor: 'white',
};
export class TimeframeSelectorPlugin extends UIPlugin {
    constructor({ flameChartNodes, settings, name = 'timeframeSelectorPlugin', }) {
        super(name);
        this.styles = defaultTimeframeSelectorPluginStyles;
        this.height = 0;
        this.leftKnobMoving = false;
        this.rightKnobMoving = false;
        this.selectingActive = false;
        this.startSelectingPosition = 0;
        this.actualClusters = [];
        this.clusters = [];
        this.flameChartMaxLevel = 0;
        this.flameChartDots = [];
        this.actualClusterizedFlatTree = [];
        this.hoveredRegion = null;
        this.flameChartNodes = flameChartNodes;
        this.shouldRender = true;
        this.setSettings(settings);
    }
    init(renderEngine, interactionsEngine) {
        super.init(renderEngine, interactionsEngine);
        this.interactionsEngine.on('down', this.handleMouseDown.bind(this));
        this.interactionsEngine.on('up', this.handleMouseUp.bind(this));
        this.interactionsEngine.on('move', this.handleMouseMove.bind(this));
        this.interactionsEngine.on('hover', this.handleHover.bind(this));
        this.setSettings();
    }
    handleHover(region) {
        this.hoveredRegion = region;
    }
    handleMouseDown(region, mouse) {
        if (region) {
            if (region.type === "timeframeKnob" /* RegionTypes.TIMEFRAME_KNOB */) {
                if (region.data === 'left') {
                    this.leftKnobMoving = true;
                }
                else {
                    this.rightKnobMoving = true;
                }
                this.interactionsEngine.setCursor('ew-resize');
            }
            else if (region.type === "timeframeArea" /* RegionTypes.TIMEFRAME_AREA */) {
                this.selectingActive = true;
                this.startSelectingPosition = mouse.x;
            }
        }
    }
    handleMouseUp(_, mouse, isClick) {
        let isDoubleClick = false;
        if (this.timeout) {
            isDoubleClick = true;
        }
        clearTimeout(this.timeout);
        this.timeout = window.setTimeout(() => (this.timeout = void 0), 300);
        this.leftKnobMoving = false;
        this.rightKnobMoving = false;
        this.interactionsEngine.clearCursor();
        if (this.selectingActive && !isClick) {
            this.applyChanges();
        }
        this.selectingActive = false;
        if (isClick && !isDoubleClick) {
            const rightKnobPosition = this.getRightKnobPosition();
            const leftKnobPosition = this.getLeftKnobPosition();
            if (mouse.x > rightKnobPosition) {
                this.setRightKnobPosition(mouse.x);
            }
            else if (mouse.x > leftKnobPosition && mouse.x < rightKnobPosition) {
                if (mouse.x - leftKnobPosition > rightKnobPosition - mouse.x) {
                    this.setRightKnobPosition(mouse.x);
                }
                else {
                    this.setLeftKnobPosition(mouse.x);
                }
            }
            else {
                this.setLeftKnobPosition(mouse.x);
            }
            this.applyChanges();
        }
        if (isDoubleClick) {
            this.renderEngine.parent.setZoom(this.renderEngine.getInitialZoom());
            this.renderEngine.parent.setPositionX(this.renderEngine.min);
            this.renderEngine.parent.render();
        }
    }
    handleMouseMove(_, mouse) {
        if (this.leftKnobMoving) {
            this.setLeftKnobPosition(mouse.x);
            this.applyChanges();
        }
        if (this.rightKnobMoving) {
            this.setRightKnobPosition(mouse.x);
            this.applyChanges();
        }
        if (this.selectingActive) {
            if (this.startSelectingPosition >= mouse.x) {
                this.setLeftKnobPosition(mouse.x);
                this.setRightKnobPosition(this.startSelectingPosition);
            }
            else {
                this.setRightKnobPosition(mouse.x);
                this.setLeftKnobPosition(this.startSelectingPosition);
            }
            this.renderEngine.render();
        }
    }
    postInit() {
        this.offscreenRenderEngine = this.renderEngine.makeChild();
        this.offscreenRenderEngine.setSettingsOverrides({ styles: this.styles });
        this.timeGrid = new TimeGrid({ styles: this.renderEngine.parent.timeGrid.styles });
        this.timeGrid.setDefaultRenderEngine(this.offscreenRenderEngine);
        this.offscreenRenderEngine.on('resize', () => {
            this.offscreenRenderEngine.setZoom(this.renderEngine.getInitialZoom());
            this.offscreenRender();
        });
        this.offscreenRenderEngine.on('min-max-change', () => (this.shouldRender = true));
        this.setData({
            flameChartNodes: this.flameChartNodes
        });
    }
    setLeftKnobPosition(mouseX) {
        const maxPosition = this.getRightKnobPosition();
        if (mouseX < maxPosition - 1) {
            const realView = this.renderEngine.getRealView();
            const delta = this.renderEngine.setPositionX(this.offscreenRenderEngine.pixelToTime(mouseX) + this.renderEngine.min);
            const zoom = this.renderEngine.width / (realView - delta);
            this.renderEngine.setZoom(zoom);
        }
    }
    setRightKnobPosition(mouseX) {
        const minPosition = this.getLeftKnobPosition();
        if (mouseX > minPosition + 1) {
            const realView = this.renderEngine.getRealView();
            const delta = this.renderEngine.positionX +
                realView -
                (this.offscreenRenderEngine.pixelToTime(mouseX) + this.renderEngine.min);
            const zoom = this.renderEngine.width / (realView - delta);
            this.renderEngine.setZoom(zoom);
        }
    }
    getLeftKnobPosition() {
        return (this.renderEngine.positionX - this.renderEngine.min) * this.renderEngine.getInitialZoom();
    }
    getRightKnobPosition() {
        return ((this.renderEngine.positionX - this.renderEngine.min + this.renderEngine.getRealView()) *
            this.renderEngine.getInitialZoom());
    }
    applyChanges() {
        this.renderEngine.parent.setPositionX(this.renderEngine.positionX);
        this.renderEngine.parent.setZoom(this.renderEngine.zoom);
        this.renderEngine.parent.render();
    }
    setSettings({ styles } = { styles: this.styles }) {
        this.styles = mergeObjects(defaultTimeframeSelectorPluginStyles, styles);
        this.height = this.styles.height;
        if (this.offscreenRenderEngine) {
            this.offscreenRenderEngine.setSettingsOverrides({ styles: this.styles });
            this.timeGrid.setSettings({ styles: this.renderEngine.parent.timeGrid.styles });
        }
        this.shouldRender = true;
    }
    makeFlameChartDots() {
        if (this.flameChartNodes) {
            const flameChartDots = [];
            const tree = flatTree(this.flameChartNodes);
            const { min, max } = getFlatTreeMinMax(tree);
            this.min = min;
            this.max = max;
            this.clusters = metaClusterizeFlatTree(tree, () => true);
            this.actualClusters = clusterizeFlatTree(this.clusters, this.renderEngine.zoom, this.min, this.max, TIMEFRAME_STICK_DISTANCE, Infinity);
            this.actualClusterizedFlatTree = reclusterizeClusteredFlatTree(this.actualClusters, this.renderEngine.zoom, this.min, this.max, TIMEFRAME_STICK_DISTANCE, Infinity).sort((a, b) => a.start - b.start);
            this.actualClusterizedFlatTree.forEach(({ start, end }) => {
                flameChartDots.push({
                    time: start,
                    type: 'start',
                }, {
                    time: end,
                    type: 'end',
                });
            });
            flameChartDots.sort((a, b) => a.time - b.time);
            const { dots, maxLevel } = this.makeRenderDots(flameChartDots);
            this.flameChartDots = dots;
            this.flameChartMaxLevel = maxLevel;
        }
    }
    makeRenderDots(dots) {
        const renderDots = [];
        let level = 0;
        let maxLevel = 0;
        dots.forEach(({ type, time }) => {
            if (type === 'start' || type === 'end') {
                renderDots.push([time, level]);
            }
            if (type === 'start') {
                level++;
            }
            else {
                level--;
            }
            maxLevel = Math.max(maxLevel, level);
            renderDots.push([time, level]);
        });
        return {
            dots: renderDots,
            maxLevel,
        };
    }
    setData({ flameChartNodes, }) {
        this.flameChartNodes = flameChartNodes;
        this.makeFlameChartDots();
        this.offscreenRender();
    }
    setFlameChartNodes(flameChartNodes) {
        this.flameChartNodes = flameChartNodes;
        this.makeFlameChartDots();
        this.offscreenRender();
    }
    offscreenRender() {
        const zoom = this.offscreenRenderEngine.getInitialZoom();
        this.offscreenRenderEngine.setZoom(zoom);
        this.offscreenRenderEngine.setPositionX(this.offscreenRenderEngine.min);
        this.offscreenRenderEngine.clear();
        this.timeGrid.recalc();
        this.timeGrid.renderLines(0, this.offscreenRenderEngine.height);
        this.timeGrid.renderTimes();
        renderChart({
            engine: this.offscreenRenderEngine,
            points: this.flameChartDots,
            min: 0,
            max: this.flameChartMaxLevel,
            style: {
                lineColor: this.styles.graphStrokeColor,
                fillColor: this.styles.graphFillColor,
                type: this.styles.flameChartGraphType,
            },
        });
        this.offscreenRenderEngine.setCtxValue('fillStyle', this.styles.bottomLineColor);
        this.offscreenRenderEngine.ctx.fillRect(0, this.height - 1, this.offscreenRenderEngine.width, 1);
    }
    renderTimeframe() {
        const relativePositionX = this.renderEngine.positionX - this.renderEngine.min;
        const currentLeftPosition = relativePositionX * this.renderEngine.getInitialZoom();
        const currentRightPosition = (relativePositionX + this.renderEngine.getRealView()) * this.renderEngine.getInitialZoom();
        const currentLeftKnobPosition = currentLeftPosition - this.styles.knobSize / 2;
        const currentRightKnobPosition = currentRightPosition - this.styles.knobSize / 2;
        const knobHeight = this.renderEngine.height / 3;
        this.renderEngine.setCtxValue('fillStyle', this.styles.overlayColor);
        this.renderEngine.fillRect(0, 0, currentLeftPosition, this.renderEngine.height);
        this.renderEngine.fillRect(currentRightPosition, 0, this.renderEngine.width - currentRightPosition, this.renderEngine.height);
        this.renderEngine.setCtxValue('fillStyle', this.styles.overlayColor);
        this.renderEngine.fillRect(currentLeftPosition - 1, 0, 1, this.renderEngine.height);
        this.renderEngine.fillRect(currentRightPosition + 1, 0, 1, this.renderEngine.height);
        this.renderEngine.setCtxValue('fillStyle', this.styles.knobColor);
        this.renderEngine.fillRect(currentLeftKnobPosition, 0, this.styles.knobSize, knobHeight);
        this.renderEngine.fillRect(currentRightKnobPosition, 0, this.styles.knobSize, knobHeight);
        this.renderEngine.renderStroke(this.styles.knobStrokeColor, currentLeftKnobPosition, 0, this.styles.knobSize, knobHeight);
        this.renderEngine.renderStroke(this.styles.knobStrokeColor, currentRightKnobPosition, 0, this.styles.knobSize, knobHeight);
        this.interactionsEngine.addHitRegion("timeframeKnob" /* RegionTypes.TIMEFRAME_KNOB */, 'left', currentLeftKnobPosition, 0, this.styles.knobSize, knobHeight, "ew-resize" /* CursorTypes.EW_RESIZE */);
        this.interactionsEngine.addHitRegion("timeframeKnob" /* RegionTypes.TIMEFRAME_KNOB */, 'right', currentRightKnobPosition, 0, this.styles.knobSize, knobHeight, "ew-resize" /* CursorTypes.EW_RESIZE */);
        this.interactionsEngine.addHitRegion("timeframeArea" /* RegionTypes.TIMEFRAME_AREA */, null, 0, 0, this.renderEngine.width, this.renderEngine.height, "text" /* CursorTypes.TEXT */);
    }
    renderTooltip() {
        if (this.hoveredRegion) {
            const mouseX = this.interactionsEngine.getMouse().x;
            const currentTimestamp = mouseX / this.renderEngine.getInitialZoom() + this.renderEngine.min;
            const time = `${currentTimestamp.toFixed(this.renderEngine.getAccuracy() + 2)} ${this.renderEngine.timeUnits}`;
            this.renderEngine.renderTooltipFromData([
                {
                    text: time,
                },
            ], this.interactionsEngine.getGlobalMouse());
            return true;
        }
        return false;
    }
    render() {
        if (this.shouldRender) {
            this.shouldRender = false;
            this.offscreenRender();
        }
        this.renderEngine.copy(this.offscreenRenderEngine);
        this.renderTimeframe();
        this.interactionsEngine.addHitRegion("timeframe" /* RegionTypes.TIMEFRAME */, null, 0, 0, this.renderEngine.width, this.height);
        return true;
    }
}
