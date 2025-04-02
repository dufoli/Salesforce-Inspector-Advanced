import { EventEmitter } from '../events.js';
import { EVENT_NAMES } from '../types.js';
export class SeparatedInteractionsEngine extends EventEmitter {
    static getId() {
        return SeparatedInteractionsEngine.count++;
    }
    constructor(parent, renderEngine) {
        super();
        this.id = SeparatedInteractionsEngine.getId();
        this.parent = parent;
        this.renderEngine = renderEngine;
        renderEngine.on('clear', () => this.clearHitRegions());
        EVENT_NAMES.forEach((eventName) => parent.on(eventName, (region, mouse, isClick) => {
            if (!region || region.id === this.id) {
                this.resend(eventName, region, mouse, isClick);
            }
        }));
        ['hover'].forEach((eventName) => parent.on(eventName, (region, mouse) => {
            if (!region || region.id === this.id) {
                this.emit(eventName, region, mouse);
            }
        }));
        parent.on('change-position', (data, startMouse, endMouse, instance) => {
            if (instance === this) {
                this.emit('change-position', data, startMouse, endMouse);
            }
        });
        this.hitRegions = [];
    }
    resend(event, ...args) {
        if (this.renderEngine.position <= this.parent.mouse.y &&
            this.renderEngine.height + this.renderEngine.position >= this.parent.mouse.y) {
            this.emit(event, ...args);
        }
    }
    getMouse() {
        const { x, y } = this.parent.mouse;
        return {
            x,
            y: y - this.renderEngine.position,
        };
    }
    getGlobalMouse() {
        return this.parent.mouse;
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
            id: this.id,
        });
    }
    setCursor(cursor) {
        this.parent.setCursor(cursor);
    }
    clearCursor() {
        this.parent.clearCursor();
    }
}
SeparatedInteractionsEngine.count = 0;
