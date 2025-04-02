import { last } from '../../utils.js';
const castLevelToHeight = (level, minLevel, levelHeight, totalheight) => {
    return totalheight - (level - minLevel) * levelHeight;
};
export const defaultChartStyle = {
    fillColor: 'rgba(0, 0, 0, 0.1)',
    lineWidth: 1,
    lineDash: [],
    lineColor: 'rgba(0, 0, 0, 0.5)',
    type: 'smooth',
};
export const getMinMax = (points, chart, summary) => {
    var _a, _b;
    return chart.dynamicMinMax
        ? points.reduce((acc, [, value]) => {
            acc.min = Math.min(acc.min, value);
            acc.max = Math.max(acc.max, value);
            return acc;
        }, { min: (_a = chart.min) !== null && _a !== void 0 ? _a : Infinity, max: (_b = chart.max) !== null && _b !== void 0 ? _b : -Infinity })
        : chart.group
            ? summary[chart.group]
            : {
                min: -Infinity,
                max: Infinity,
            };
};
export const renderChart = ({ engine, points, style, min, max, }) => {
    const resolvedStyle = {
        ...defaultChartStyle,
        ...(style !== null && style !== void 0 ? style : {}),
    };
    engine.setCtxValue('strokeStyle', resolvedStyle.lineColor);
    engine.setCtxValue('fillStyle', resolvedStyle.fillColor);
    engine.setCtxValue('lineWidth', resolvedStyle.lineWidth);
    engine.callCtx('setLineDash', resolvedStyle.lineDash);
    engine.ctx.beginPath();
    const levelHeight = (engine.height - engine.charHeight - 4) / (max - min);
    if (points.length > 1) {
        const xy = points.map(([time, level]) => [
            engine.timeToPosition(time),
            castLevelToHeight(level, min, levelHeight, engine.height),
        ]);
        engine.ctx.moveTo(xy[0][0], engine.height);
        engine.ctx.lineTo(xy[0][0], xy[0][1]);
        if (resolvedStyle.type === 'smooth' || !resolvedStyle.type) {
            for (let i = 1; i < xy.length - 2; i++) {
                const xc = (xy[i][0] + xy[i + 1][0]) / 2;
                const yc = (xy[i][1] + xy[i + 1][1]) / 2;
                engine.ctx.quadraticCurveTo(xy[i][0], xy[i][1], xc, yc);
            }
            const preLastPoint = xy[xy.length - 2];
            const lastPoint = last(xy);
            engine.ctx.quadraticCurveTo(preLastPoint[0], preLastPoint[1], lastPoint[0], lastPoint[1]);
            engine.ctx.quadraticCurveTo(lastPoint[0], lastPoint[1], lastPoint[0], engine.height);
        }
        else if (resolvedStyle.type === 'line') {
            for (let i = 1; i < xy.length; i++) {
                engine.ctx.lineTo(xy[i][0], xy[i][1]);
            }
        }
        else if (resolvedStyle.type === 'bar') {
            for (let i = 0; i < xy.length; i++) {
                const currentPoint = xy[i];
                const prevPoint = xy[i - 1] || currentPoint;
                const nextPoint = xy[i + 1];
                const barWidthLeft = (currentPoint[0] - prevPoint[0]) / 2;
                const barWidthRight = nextPoint ? (nextPoint[0] - currentPoint[0]) / 2 : barWidthLeft;
                engine.ctx.lineTo(prevPoint[0] + barWidthLeft, currentPoint[1]);
                engine.ctx.lineTo(currentPoint[0] + barWidthRight, currentPoint[1]);
                if (nextPoint) {
                    engine.ctx.lineTo(currentPoint[0] + barWidthRight, nextPoint[1]);
                }
                else {
                    engine.ctx.lineTo(currentPoint[0] + barWidthRight, engine.height);
                }
            }
            engine.ctx.lineTo(last(xy)[0], engine.height);
        }
    }
    engine.ctx.closePath();
    engine.ctx.stroke();
    engine.ctx.fill();
};
export const chartPointsBinarySearch = (array, value, outside = true) => {
    if (array[0][0] >= value) {
        return outside ? array[0] : null;
    }
    if (last(array)[0] <= value) {
        return outside ? last(array) : null;
    }
    if (array.length <= 1) {
        return array[0];
    }
    let start = 0;
    let end = array.length - 1;
    while (start <= end) {
        const mid = Math.ceil((end + start) / 2);
        if (value >= array[mid - 1][0] && value <= array[mid][0]) {
            const index = Math.abs(value - array[mid - 1][0]) < Math.abs(value - array[mid][0]) ? mid - 1 : mid;
            return array[index];
        }
        if (array[mid][0] < value) {
            start = mid + 1;
        }
        else {
            end = mid - 1;
        }
    }
    return null;
};
