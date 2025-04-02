import { RenderEngine } from './engines/render-engine.js';
import { InteractionsEngine } from './engines/interactions-engine.js';
import { EventEmitter } from './events.js';
import { TimeGrid } from './engines/time-grid.js';
export class FlameChartContainer extends EventEmitter {
    constructor({ canvas, plugins, settings }) {
        var _a;
        super();
        const styles = (_a = settings === null || settings === void 0 ? void 0 : settings.styles) !== null && _a !== void 0 ? _a : {};
        this.timeGrid = new TimeGrid({ styles: styles === null || styles === void 0 ? void 0 : styles.timeGrid });
        this.renderEngine = new RenderEngine({
            canvas,
            settings: {
                styles: styles === null || styles === void 0 ? void 0 : styles.main,
                options: settings === null || settings === void 0 ? void 0 : settings.options,
            },
            plugins,
            timeGrid: this.timeGrid,
        });
        this.interactionsEngine = new InteractionsEngine(canvas, this.renderEngine, settings === null || settings === void 0 ? void 0 : settings.options);
        this.plugins = plugins;
        const children = Array(this.plugins.length)
            .fill(null)
            .map(() => {
            const renderEngine = this.renderEngine.makeInstance();
            const interactionsEngine = this.interactionsEngine.makeInstance(renderEngine);
            return { renderEngine, interactionsEngine };
        });
        this.plugins.forEach((plugin, index) => {
            plugin.init(children[index].renderEngine, children[index].interactionsEngine);
        });
        this.renderEngine.calcMinMax();
        this.renderEngine.resetView();
        this.renderEngine.recalcChildrenLayout();
        this.renderEngine.calcTimeGrid();
        this.plugins.forEach((plugin) => { var _a; return (_a = plugin.postInit) === null || _a === void 0 ? void 0 : _a.call(plugin); });
        this.renderEngine.render();
    }
    render() {
        this.renderEngine.render();
    }
    resize(width, height) {
        this.renderEngine.render(() => this.renderEngine.resize(width, height));
    }
    execOnPlugins(fnName, ...args) {
        let index = 0;
        while (index < this.plugins.length) {
            if (this.plugins[index][fnName]) {
                this.plugins[index][fnName](...args);
            }
            index++;
        }
    }
    setSettings(settings) {
        var _a, _b;
        this.timeGrid.setSettings({ styles: (_a = settings.styles) === null || _a === void 0 ? void 0 : _a.timeGrid });
        this.renderEngine.setSettings({
            options: settings.options,
            styles: (_b = settings.styles) === null || _b === void 0 ? void 0 : _b.main,
            patterns: settings.patterns,
        });
        this.plugins.forEach((plugin) => { var _a, _b; return (_a = plugin.setSettings) === null || _a === void 0 ? void 0 : _a.call(plugin, { styles: (_b = settings.styles) === null || _b === void 0 ? void 0 : _b[plugin.name] }); });
        this.renderEngine.render();
    }
    setZoom(start, end) {
        const zoom = this.renderEngine.width / (end - start);
        this.renderEngine.setPositionX(start);
        this.renderEngine.setZoom(zoom);
        this.renderEngine.render();
    }
    hotkeys(status) {
        this.interactionsEngine.hotkeys(status);
    }
}
export default FlameChartContainer;
