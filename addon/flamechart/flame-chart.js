import { FlameChartContainer } from './flame-chart-container.js';
import { TimeGridPlugin } from './plugins/time-grid-plugin.js';
import { TimeframeSelectorPlugin } from './plugins/timeframe-selector-plugin.js';
import { FlameChartPlugin } from './plugins/flame-chart-plugin.js';
import { MarksPlugin } from './plugins/marks-plugin.js';
const defaultSettings = {};
export class FlameChart extends FlameChartContainer {
    constructor({ canvas, data, marks, colors, settings = defaultSettings, plugins = [], }) {
        var _a;
        const activePlugins = [];
        const { headers: { flameChart: flameChartName = 'flame chart' } = {} } = settings;
        const styles = (_a = settings === null || settings === void 0 ? void 0 : settings.styles) !== null && _a !== void 0 ? _a : {};
        const timeGridPlugin = new TimeGridPlugin({ styles: styles === null || styles === void 0 ? void 0 : styles.timeGridPlugin });
        activePlugins.push(timeGridPlugin);
        let timeframeSelectorPlugin;
        let flameChartPlugin;
        let marksPlugin;
        if (marks) {
            marksPlugin = new MarksPlugin({ data: marks });
            marksPlugin.on('select', (data) => this.emit('select', data));

            activePlugins.push(marksPlugin);
        }
        if (data) {
            flameChartPlugin = new FlameChartPlugin({ data, colors });
            flameChartPlugin.on('select', (data) => this.emit('select', data));
            activePlugins.push(flameChartPlugin);
        }
        if (data) {
            timeframeSelectorPlugin = new TimeframeSelectorPlugin({
                flameChartNodes: data,
                settings: { styles: styles === null || styles === void 0 ? void 0 : styles.timeframeSelectorPlugin },
            });
            activePlugins.unshift(timeframeSelectorPlugin);
        }
        super({
            canvas,
            settings,
            plugins: [...activePlugins, ...plugins],
        });
        if (flameChartPlugin && timeframeSelectorPlugin) {
            this.setNodes = (data) => {
                if (flameChartPlugin) {
                    flameChartPlugin.setData(data);
                }
                if (timeframeSelectorPlugin) {
                    timeframeSelectorPlugin.setFlameChartNodes(data);
                }
            };
            this.setFlameChartPosition = ({ x, y }) => {
                if (typeof x === 'number') {
                    this.renderEngine.setPositionX(x);
                }
                if (typeof y === 'number' && flameChartPlugin) {
                    flameChartPlugin.setPositionY(y);
                }
                this.renderEngine.render();
            };
        }
        if (marksPlugin) {
            this.setMarks = (data) => {
                if (marksPlugin) {
                    marksPlugin.setMarks(data);
                }
            };
        }
    }
}
export default FlameChart;
