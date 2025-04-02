import { last } from '../../utils.js';
const MIN_BLOCK_SIZE = 1;
const STICK_DISTANCE = 0.25;
const MIN_CLUSTER_SIZE = MIN_BLOCK_SIZE * 2 + STICK_DISTANCE;
export const walk = (treeList, cb, parent = null, level = 0) => {
    treeList.forEach((child) => {
        const res = cb(child, parent, level);
        if (child.children) {
            walk(child.children, cb, res || child, level + 1);
        }
    });
};
export const flatTree = (treeList) => {
    const result = [];
    let index = 0;
    walk(treeList, (node, parent, level) => {
        const newNode = {
            source: node,
            end: node.start + node.duration,
            parent,
            level,
            index: index++,
        };
        result.push(newNode);
        return newNode;
    });
    return result.sort((a, b) => a.level - b.level || a.source.start - b.source.start);
};
export const getFlatTreeMinMax = (flatTree) => {
    let isFirst = true;
    let min = 0;
    let max = 0;
    flatTree.forEach(({ source: { start }, end }) => {
        if (isFirst) {
            min = start;
            max = end;
            isFirst = false;
        }
        else {
            min = min < start ? min : start;
            max = max > end ? max : end;
        }
    });
    return { min, max };
};
const calcClusterDuration = (nodes) => {
    const firstNode = nodes[0];
    const lastNode = last(nodes);
    return lastNode.source.start + lastNode.source.duration - firstNode.source.start;
};
const checkNodeTimeboundNesting = (node, start, end) => (node.source.start < end && node.end > start) || (node.source.start > start && node.end < end);
const checkClusterTimeboundNesting = (node, start, end) => (node.start < end && node.end > start) || (node.start > start && node.end < end);
const defaultClusterizeCondition = (prevNode, node) => prevNode.source.color === node.source.color &&
    prevNode.source.pattern === node.source.pattern &&
    prevNode.source.type === node.source.type;
export function metaClusterizeFlatTree(flatTree, condition = defaultClusterizeCondition) {
    return flatTree
        .reduce((acc, node) => {
        const lastCluster = last(acc);
        const lastNode = lastCluster && last(lastCluster);
        if (lastNode && lastNode.level === node.level && condition(lastNode, node)) {
            lastCluster.push(node);
        }
        else {
            acc.push([node]);
        }
        return acc;
    }, [])
        .filter((nodes) => nodes.length)
        .map((nodes) => ({
        nodes,
    }));
}
export const clusterizeFlatTree = (metaClusterizedFlatTree, zoom, start = 0, end = 0, stickDistance = STICK_DISTANCE, minBlockSize = MIN_BLOCK_SIZE) => {
    let lastCluster = null;
    let lastNode = null;
    let index = 0;
    return metaClusterizedFlatTree
        .reduce((acc, { nodes }) => {
        lastCluster = null;
        lastNode = null;
        index = 0;
        for (const node of nodes) {
            if (checkNodeTimeboundNesting(node, start, end)) {
                if (lastCluster && !lastNode) {
                    lastCluster[index] = node;
                    index++;
                }
                else if (lastCluster &&
                    lastNode &&
                    (node.source.start - (lastNode.source.start + lastNode.source.duration)) * zoom <
                        stickDistance &&
                    node.source.duration * zoom < minBlockSize &&
                    lastNode.source.duration * zoom < minBlockSize) {
                    lastCluster[index] = node;
                    index++;
                }
                else {
                    lastCluster = [node];
                    index = 1;
                    acc.push(lastCluster);
                }
                lastNode = node;
            }
        }
        return acc;
    }, [])
        .map((nodes) => {
        var _a;
        const node = nodes[0];
        const duration = calcClusterDuration(nodes);
        const badge = (_a = nodes.find((node) => node.source.badge)) === null || _a === void 0 ? void 0 : _a.source.badge;
        return {
            start: node.source.start,
            end: node.source.start + duration,
            duration,
            type: node.source.type,
            color: node.source.color,
            pattern: node.source.pattern,
            level: node.level,
            badge,
            nodes,
        };
    });
};
export const reclusterizeClusteredFlatTree = (clusteredFlatTree, zoom, start, end, stickDistance, minBlockSize) => {
    return clusteredFlatTree.reduce((acc, cluster) => {
        if (checkClusterTimeboundNesting(cluster, start, end)) {
            if (cluster.duration * zoom <= MIN_CLUSTER_SIZE) {
                acc.push(cluster);
            }
            else {
                acc.push(...clusterizeFlatTree([cluster], zoom, start, end, stickDistance, minBlockSize));
            }
        }
        return acc;
    }, []);
};
