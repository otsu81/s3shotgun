const AWS = require('aws-sdk');
const getPaginatedResults = require('./paginator');

exports.getCurrentRunningTasks = async function(params) {
    const ecs = new AWS.ECS();
    let tasks = await getPaginatedResults(async (NextMarker) => {
        const t = await ecs.listTasks({
            cluster: params.ecsCluster,
            desiredStatus: 'RUNNING',
            nextToken: NextMarker
        }).promise();
        return {
            marker: t.nextToken,
            results: t.taskArns
        }
    });

    return tasks;
};

exports.runNewTasks = async function(params) {
    const ecs = new AWS.ECS();
    let results = await ecs.runTask(params).promise();
    console.log(results);
    return results;
};