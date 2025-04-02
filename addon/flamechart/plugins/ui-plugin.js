import { EventEmitter } from '../events.js';
export class UIPlugin extends EventEmitter {
    constructor(name) {
        super();
        this.name = name;
    }
    get fullHeight() {
        return typeof this.height === 'number' ? this.height : 0;
    }
    init(renderEngine, interactionsEngine) {
        this.renderEngine = renderEngine;
        this.interactionsEngine = interactionsEngine;
    }
}
export default UIPlugin;
