const AWS = require('aws-sdk');
const ecsOperations = require('./ecsOperations');

/*
Example expected event input:
{
    'sqsUrl': sqsPaths.queueUrl,
    'ecsCluster': cluster.clusterArn,
    'maxTasks': '500',
    'maxBacklog': '100',
    'tasksStepping': '10',
    'taskDefinition': s3ShotgunConsumerTask.taskDefinitionArn,
    'subnetIds': subnetIds.join()
}*/
exports.handler = async function(event, context) {
    // check SQS queue, if 0 do nothing
    const sqs = new AWS.SQS();
    const messages = await sqs.getQueueAttributes({QueueUrl: event.sqsUrl, AttributeNames: [ 'ApproximateNumberOfMessages' ]}).promise();
    const queueLength = messages['Attributes']['ApproximateNumberOfMessages'];
    if (queueLength == 0) {
        // console.log('0 messages in queue, nothing to do - exiting...')
        return;
    }


    // check running tasks, if max or more DO NOTHING
    const runningTasks = await ecsOperations.getCurrentRunningTasks(event);
    if (runningTasks.length >= event.maxTasks) {
        console.log('Max running tasks, do nothing');
        return;
    }

    // set desired tasks to be the smaller of remaining tasks and max tasks
    let remainingTasks = Math.ceil(queueLength/event.maxBacklog);
    let desiredTasks = (event.maxTasks < remainingTasks) ? event.maxTasks : remainingTasks;
    console.log('Desired tasks:', desiredTasks);

    // if desired tasks <= running tasks
        // RETURN, DO NOTHING
    if (runningTasks.length >= desiredTasks) {
        console.log('More running tasks than desired, do nothing');
        return;
    }

    // add as many tasks as possible to either get desired or max tasks
    let tasksToAdd;
    if (runningTasks.length + event.tasksStepping > desiredTasks) tasksToAdd = desiredTasks - runningTasks;
    else if (runningTasks.length + event.tasksStepping < event.maxTasks) tasksToAdd = event.tasksStepping;
    else tasksToAdd = event.tasksStepping;

    // can't add more than 10 tasks per invocation (ecs limitation)
    if (tasksToAdd > 10) tasksToAdd = 10;

    await ecsOperations.runNewTasks(
        {
            cluster: event.ecsCluster,
            taskDefinition: event.taskDefinition,
            count: tasksToAdd,
            launchType: 'FARGATE',
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: event.subnetIds.split(','),
                    assignPublicIp: 'ENABLED'
                },
            }
        }
    );

    console.log('Tasks to add:', tasksToAdd);


}