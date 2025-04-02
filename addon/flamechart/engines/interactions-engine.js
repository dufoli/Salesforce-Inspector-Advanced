import { EventEmitter } from '../events.js';
import { SeparatedInteractionsEngine } from './separated-interactions-engine.js';
import { mergeObjects } from '../utils.js';
const defaultInteractionsOptions = {
    hotkeys: {
        scrollSpeed: 0.5,
        zoomSpeed: 0.001,
        fastMultiplayer: 5,
        active: false,
    },
};
export class InteractionsEngine extends EventEmitter {
    constructor(canvas, renderEngine, settings) {
        var _a;
        super();
        this.selectedRegion = null;
        this.hoveredRegion = null;
        this.moveActive = false;
        this.currentCursor = null;
        this.keys = {};
        this.hotkeysActive = false;
        this.renderEngine = renderEngine;
        this.canvas = canvas;
        this.settings = {
            hotkeys: mergeObjects(defaultInteractionsOptions.hotkeys, settings === null || settings === void 0 ? void 0 : settings.hotkeys),
        };
        this.hotkeysActive = Boolean((_a = settings === null || settings === void 0 ? void 0 : settings.hotkeys) === null || _a === void 0 ? void 0 : _a.active);
        this.hitRegions = [];
        this.instances = [];
        this.mouse = {
            x: 0,
            y: 0,
        };
        this.handleMouseWheel = this.handleMouseWheel.bind(this);
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.initListeners();
        this.reset();
    }
    makeInstance(renderEngine) {
        const separatedInteractionsEngine = new SeparatedInteractionsEngine(this, renderEngine);
        this.instances.push(separatedInteractionsEngine);
        return separatedInteractionsEngine;
    }
    reset() {
        this.selectedRegion = null;
        this.hoveredRegion = null;
        this.hitRegions = [];
    }
    destroy() {
        this.removeListeners();
    }
    initListeners() {
        if (this.canvas) {
            this.canvas.addEventListener('wheel', this.handleMouseWheel);
            this.canvas.addEventListener('mousedown', this.handleMouseDown);
            this.canvas.addEventListener('mouseup', this.handleMouseUp);
            this.canvas.addEventListener('mouseleave', this.handleMouseUp);
            this.canvas.addEventListener('mousemove', this.handleMouseMove);
            document.addEventListener('keydown', this.handleKeyDown);
            document.addEventListener('keyup', this.handleKeyUp);
        }
    }
    removeListeners() {
        if (this.canvas) {
            this.canvas.removeEventListener('wheel', this.handleMouseWheel);
            this.canvas.removeEventListener('mousedown', this.handleMouseDown);
            this.canvas.removeEventListener('mouseup', this.handleMouseUp);
            this.canvas.removeEventListener('mouseleave', this.handleMouseUp);
            this.canvas.removeEventListener('mousemove', this.handleMouseMove);
            document.removeEventListener('keydown', this.handleKeyDown);
            document.removeEventListener('keyup', this.handleKeyUp);
        }
    }
    hotkeys(status) {
        this.hotkeysActive = status;
    }
    handleKeyDown(e) {
        if (!this.keys[e.key] && this.hotkeysActive) {
            this.keys[e.key] = true;
            this.continueHandleKeys();
        }
    }
    handleKeyUp(e) {
        if (this.hotkeysActive) {
            this.keys[e.key] = false;
        }
    }
    continueHandleKeys() {
        this.renderEngine.render((delta) => this.handleKeys(delta));
    }
    key(code) {
        return Boolean(this.keys[code]);
    }
    getSpeed() {
        const { fastMultiplayer } = this.settings.hotkeys;
        const isFast = this.key('Shift');
        return isFast ? fastMultiplayer : 1;
    }
    handleKeys(timeDelta) {
        const speed = this.getSpeed();
        if (this.key('ArrowRight') || this.key('ArrowLeft')) {
            const isRight = this.key('ArrowRight');
            const { scrollSpeed } = this.settings.hotkeys;
            const positionDelta = ((isRight ? 1 : -1) * scrollSpeed * speed * timeDelta) / this.renderEngine.zoom;
            this.renderEngine.tryToChangePosition(positionDelta);
            this.continueHandleKeys();
        }
        if (this.key('=') || this.key('ArrowUp') || this.key('-') || this.key('ArrowDown')) {
            const isPlus = this.key('=') || this.key('ArrowUp');
            const { zoomSpeed } = this.settings.hotkeys;
            const zoomDelta = (isPlus ? -1 : 1) * zoomSpeed * speed * timeDelta * this.renderEngine.zoom;
            this.changeZoom(zoomDelta, this.renderEngine.width / 2);
            this.continueHandleKeys();
        }
    }
    handleMouseWheel(e) {
        const { deltaY, deltaX } = e;
        e.preventDefault();
        const startPosition = this.renderEngine.positionX;
        const startZoom = this.renderEngine.zoom;
        const positionScrollDelta = deltaX / this.renderEngine.zoom;
        this.renderEngine.tryToChangePosition(positionScrollDelta);
        const speed = this.getSpeed();
        this.changeZoom((deltaY / 1000) * speed * this.renderEngine.zoom, this.mouse.x);
        this.checkRegionHover();
        if (startPosition !== this.renderEngine.positionX || startZoom !== this.renderEngine.zoom) {
            this.renderEngine.render();
        }
    }
    changeZoom(zoomDelta, positionX = this.renderEngine.width / 2) {
        const realView = this.renderEngine.getRealView();
        const zoomed = this.renderEngine.setZoom(this.renderEngine.zoom - zoomDelta);
        if (zoomed) {
            this.fixPositionAfterZoom(realView, positionX);
        }
    }
    fixPositionAfterZoom(realView, fromPoint) {
        const proportion = fromPoint / this.renderEngine.width;
        const timeDelta = realView - this.renderEngine.width / this.renderEngine.zoom;
        const positionDelta = timeDelta * proportion;
        this.renderEngine.tryToChangePosition(positionDelta);
    }
    handleMouseDown() {
        this.moveActive = true;
        this.mouseDownPosition = {
            x: this.mouse.x,
            y: this.mouse.y,
        };
        this.mouseDownHoveredInstance = this.hoveredInstance;
        this.emit('down', this.hoveredRegion, this.mouse);
    }
    handleMouseUp() {
        this.moveActive = false;
        const isClick = this.mouseDownPosition &&
            this.mouseDownPosition.x === this.mouse.x &&
            this.mouseDownPosition.y === this.mouse.y;
        if (isClick) {
            this.handleRegionHit();
        }
        this.emit('up', this.hoveredRegion, this.mouse, isClick);
        if (isClick) {
            this.emit('click', this.hoveredRegion, this.mouse);
        }
    }
    handleMouseMove(e) {
        if (this.moveActive) {
            const mouseDeltaY = this.mouse.y - e.offsetY;
            const mouseDeltaX = (this.mouse.x - e.offsetX) / this.renderEngine.zoom;
            if (mouseDeltaY || mouseDeltaX) {
                this.emit('change-position', {
                    deltaX: mouseDeltaX,
                    deltaY: mouseDeltaY,
                }, this.mouseDownPosition, this.mouse, this.mouseDownHoveredInstance);
            }
        }
        this.mouse.x = e.offsetX;
        this.mouse.y = e.offsetY;
        this.checkRegionHover();
        this.emit('move', this.hoveredRegion, this.mouse);
    }
    handleRegionHit() {
        const selectedRegion = this.getHoveredRegion();
        this.emit('select', selectedRegion, this.mouse);
    }
    checkRegionHover() {
        const hoveredRegion = this.getHoveredRegion();
        if (hoveredRegion && this.hoveredRegion && hoveredRegion.id !== this.hoveredRegion.id) {
            this.emit('hover', null, this.mouse);
        }
        if (hoveredRegion) {
            if (!this.currentCursor && hoveredRegion.cursor) {
                this.renderEngine.canvas.style.cursor = hoveredRegion.cursor;
            }
            else if (!this.currentCursor) {
                this.clearCursor();
            }
            this.hoveredRegion = hoveredRegion;
            this.emit('hover', hoveredRegion, this.mouse);
            this.renderEngine.partialRender();
        }
        else if (this.hoveredRegion && !hoveredRegion) {
            if (!this.currentCursor) {
                this.clearCursor();
            }
            this.hoveredRegion = null;
            this.emit('hover', null, this.mouse);
            this.renderEngine.partialRender();
        }
    }
    getHoveredRegion() {
        const hoveredRegion = this.hitRegions.find(({ x, y, w, h }) => this.mouse.x >= x && this.mouse.x <= x + w && this.mouse.y >= y && this.mouse.y <= y + h);
        if (hoveredRegion) {
            return hoveredRegion;
        }
        const hoveredInstance = this.instances.find(({ renderEngine }) => renderEngine.position <= this.mouse.y && renderEngine.height + renderEngine.position >= this.mouse.y);
        this.hoveredInstance = hoveredInstance;
        if (hoveredInstance) {
            const offsetTop = hoveredInstance.renderEngine.position;
            return hoveredInstance.hitRegions.find(({ x, y, w, h }) => this.mouse.x >= x &&
                this.mouse.x <= x + w &&
                this.mouse.y >= y + offsetTop &&
                this.mouse.y <= y + h + offsetTop);
        }
        return null;
    }
    clearHitRegions() {
        this.hitRegions = [];
    }
    addHitRegion(type, data, x, y, w, h, cursor) {
        this.hitRegions.push({
            type,
            data,
            x,
            y,
            w,
            h,
            cursor,
        });
    }
    setCursor(cursor) {
        this.renderEngine.canvas.style.cursor = cursor;
        this.currentCursor = cursor;
    }
    clearCursor() {
        const hoveredRegion = this.getHoveredRegion();
        this.currentCursor = null;
        if (hoveredRegion === null || hoveredRegion === void 0 ? void 0 : hoveredRegion.cursor) {
            this.renderEngine.canvas.style.cursor = hoveredRegion.cursor;
        }
        else {
            this.renderEngine.canvas.style.cursor = '';
        }
    }
}
