import Color from '../color.js';
import UIPlugin from './ui-plugin.js';

export class MarksPlugin extends UIPlugin {
    marks;
    hoveredRegion = null;
    selectedRegion = null;

    constructor({ data, name = 'marksPlugin' }) {
        super(name);
        this.marks = this.prepareMarks(data);

        this.calcMinMax();
    }

    calcMinMax() {
        const { marks } = this;

        if (marks.length) {
            this.min = marks.reduce((acc, { timestamp }) => (timestamp < acc ? timestamp : acc), marks[0].timestamp);
            this.max = marks.reduce((acc, { timestamp }) => (timestamp > acc ? timestamp : acc), marks[0].timestamp);
        }
    }

    init(renderEngine, interactionsEngine) {
        super.init(renderEngine, interactionsEngine);

        this.interactionsEngine.on('hover', this.handleHover.bind(this));
        this.interactionsEngine.on('select', this.handleSelect.bind(this));
    }

    handleHover(region) {
        this.hoveredRegion = region;
    }

    handleSelect(region) {
        if (this.selectedRegion !== region) {
            this.selectedRegion = region;
            this.emit('select', { node: region?.data ?? null, type: 'mark' });
            this.renderEngine.render();
        }
    }

    get height() {
        return this.renderEngine.blockHeight + 2;
    }

    prepareMarks(marks) {
        return marks
            .map(({ color, ...rest }) => ({
                ...rest,
                color: new Color(color).alpha(0.7).rgb().toString(),
            }))
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    setMarks(marks) {
        this.marks = this.prepareMarks(marks);

        this.calcMinMax();

        this.renderEngine.recalcMinMax();
        this.renderEngine.resetParentView();
    }

    calcMarksBlockPosition(position, prevEnding) {
        if (position > 0) {
            if (prevEnding > position) {
                return prevEnding;
            }

            return position;
        }

        return position;
    }

    render() {
        this.marks.reduce((prevEnding, node) => {
            const { timestamp, color, shortName } = node;
            const { width } = this.renderEngine.ctx.measureText(shortName);
            const fullWidth = width + this.renderEngine.blockPaddingLeftRight * 2;
            const position = this.renderEngine.timeToPosition(timestamp);
            const blockPosition = this.calcMarksBlockPosition(position, prevEnding);

            this.renderEngine.addRect({ color, x: blockPosition, y: 1, w: fullWidth });
            this.renderEngine.addText({ text: shortName, x: blockPosition, y: 1, w: fullWidth });

            this.interactionsEngine.addHitRegion(
                "timestamp",
                node,
                blockPosition,
                1,
                fullWidth,
                this.renderEngine.blockHeight,
            );

            return blockPosition + fullWidth;
        }, 0);
    }

    postRender() {
        this.marks.forEach((node) => {
            const { timestamp, color } = node;
            const position = this.renderEngine.timeToPosition(timestamp);

            this.renderEngine.parent.setCtxValue('strokeStyle', color);
            this.renderEngine.parent.setCtxValue('lineWidth', 1);
            this.renderEngine.parent.callCtx('setLineDash', [8, 7]);
            this.renderEngine.parent.ctx.beginPath();
            this.renderEngine.parent.ctx.moveTo(position, this.renderEngine.position);
            this.renderEngine.parent.ctx.lineTo(position, this.renderEngine.parent.height);
            this.renderEngine.parent.ctx.stroke();
        });
    }

    renderTooltip() {
        if (this.hoveredRegion && this.hoveredRegion.type === 'timestamp') {
            if (this.renderEngine.options.tooltip === false) {
                return true;
            } else if (typeof this.renderEngine.options.tooltip === 'function') {
                this.renderEngine.options.tooltip(
                    this.hoveredRegion,
                    this.renderEngine,
                    this.interactionsEngine.getGlobalMouse(),
                );
            } else {
                const {
                    data: { fullName, timestamp },
                } = this.hoveredRegion;

                const marksAccuracy = this.renderEngine.getAccuracy() + 2;
                const header = `${fullName}`;
                const time = `${timestamp.toFixed(marksAccuracy)} ${this.renderEngine.timeUnits}`;

                this.renderEngine.renderTooltipFromData(
                    [{ text: header }, { text: time }],
                    this.interactionsEngine.getGlobalMouse(),
                );
            }

            return true;
        }

        return false;
    }
}