import { mergeObjects } from '../utils.js';
import UIPlugin from './ui-plugin.js';
export const defaultTimeGridPluginStyles = {
    font: '10px sans-serif',
    fontColor: 'black',
};
export class TimeGridPlugin extends UIPlugin {
    constructor(settings = {}) {
        super('timeGridPlugin');
        this.styles = defaultTimeGridPluginStyles;
        this.height = 0;
        this.setSettings(settings);
    }
    setSettings({ styles }) {
        this.styles = mergeObjects(defaultTimeGridPluginStyles, styles);
        if (this.renderEngine) {
            this.overrideEngineSettings();
        }
    }
    overrideEngineSettings() {
        this.renderEngine.setSettingsOverrides({ styles: this.styles });
        this.height = Math.round(this.renderEngine.charHeight + 10);
    }
    init(renderEngine, interactionsEngine) {
        super.init(renderEngine, interactionsEngine);
        this.overrideEngineSettings();
    }
    render() {
        this.renderEngine.parent.timeGrid.renderTimes(this.renderEngine);
        this.renderEngine.parent.timeGrid.renderLines(0, this.renderEngine.height, this.renderEngine);
        return true;
    }
}
