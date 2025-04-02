export const mergeObjects = (defaults, current = {}) => Object.keys(defaults).reduce((acc, key) => {
    if (current[key]) {
        acc[key] = current[key];
    }
    else {
        acc[key] = defaults[key];
    }
    return acc;
}, {});
export const isNumber = (val) => typeof val === 'number';
export const last = (array) => array[array.length - 1];
export const getTrianglePoints = (width, height, direction) => {
    const side = (width * Math.SQRT2) / 2;
    let points = [];
    switch (direction) {
        case 'top':
            points = [
                { x: 0, y: height },
                { x: width / 2, y: 0 },
                { x: width, y: height },
            ];
            break;
        case 'bottom':
            points = [
                { x: 0, y: 0 },
                { x: width, y: 0 },
                { x: width / 2, y: height },
            ];
            break;
        case 'left':
            points = [
                { x: height, y: 0 },
                { x: height, y: width },
                { x: 0, y: width / 2 },
            ];
            break;
        case 'right':
            points = [
                { x: 0, y: 0 },
                { x: 0, y: width },
                { x: height, y: width / 2 },
            ];
            break;
        case 'top-left':
            points = [
                { x: 0, y: 0 },
                { x: side, y: 0 },
                { x: 0, y: side },
            ];
            break;
        case 'top-right':
            points = [
                { x: 0, y: 0 },
                { x: side, y: 0 },
                { x: side, y: side },
            ];
            break;
        case 'bottom-left':
            points = [
                { x: 0, y: 0 },
                { x: 0, y: side },
                { x: side, y: side },
            ];
            break;
        case 'bottom-right':
            points = [
                { x: side, y: 0 },
                { x: 0, y: side },
                { x: side, y: side },
            ];
            break;
    }
    return points;
};
