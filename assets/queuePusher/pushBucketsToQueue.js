const aws = require('aws-sdk');
const args = require('minimist')(process.argv.slice(2), {
    alias: {
        help: 'h',
        QueueUrl: 'q',
        Bucket: 'b'
    }
});

if (args.h || !process.argv[2]) {
    console.log('Usage: node pushBucketsToQueue --QueueUrl [sqsUrl] --Bucket [s3BucketName]',
    '\nExample:\nnode pushBucketsToQueue.js --QueueUrl https://sqs.eu-west-1.amazonaws.com/123456789012/bucketsToSyncQueue --Bucket my-bucket');
    process.exit(0);
}

requiredArgs = ['QueueUrl', 'Bucket'];
requiredArgs.forEach(element => {
    if (!args[element]) {
        console.log(`Missing argument ${element}, see --help for required arguments and options`)
        process.exit(1);
    }
});

// the input really should be a parsed list of buckets but i'm too lazy to implement it
const buckets = [args['Bucket']];

let sqs = new aws.SQS();
let count = 0;
let promises = [];
while (buckets.length > 0) {
    let entries = [];
    for (let i = 0; i < 10 && i < buckets.length; i++) { // 10 is max size of SQS batch
        bucket = buckets.pop();
        var hrTime = process.hrtime();
        timestamp = hrTime[0] * 1000000 + hrTime[1];
        entries.push({
            Id: timestamp.toString(),
            MessageBody: `Path added ${timestamp}`,
            MessageAttributes: {
                'Bucket': {
                    DataType: 'String',
                    StringValue: bucket
                },
            },
            MessageBody: bucket,
        });
    };
    batchParams = {
        Entries: entries,
        QueueUrl: args['QueueUrl']
    }
    promises.push(sqs.sendMessageBatch(batchParams).promise());
};
Promise.all(promises);


sqs.getQueueAttributes(
    {QueueUrl: args['QueueUrl'], AttributeNames: [ 'ApproximateNumberOfMessages' ]},
    function(err, data) {
        if (err) console.log(err);
        else {
            console.log(data);
        }
    }
)
