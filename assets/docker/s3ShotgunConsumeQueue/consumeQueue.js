const { Consumer } = require('sqs-consumer');
const { exec } = require('child_process');
const AWS = require('aws-sdk');
const util = require('util');

const STORAGE_CLASS = 'STANDARD_IA' // STANDARD | REDUCED_REDUNDANCY | STANDARD_IA | ONEZONE_IA | INTELLIGENT_TIERING | GLACIER | DEEP_ARCHIVE
const DEBUG = false;


const cliS3Operation = async(params) => {
    // give target bucket account ownership with --acl bucket-owner-full-control
    let s3cmd = `aws s3 ${params.S3Operation} s3://${params.SourceBucket}/${params.Path} s3://${params.TargetBucket}/${params.Path} --acl bucket-owner-full-control --storage-class ${STORAGE_CLASS} --cli-connect-timeout 0`;
    let p = util.promisify(exec);
    let result = await p(s3cmd);
    if (DEBUG) console.log(result.stdout);
}

const consumer = Consumer.create({
    queueUrl: process.argv[2],
    messageAttributeNames: ['All'],
    handleMessage: async (message) => {
        switch (message.MessageAttributes.PathType.StringValue){
            case 'file':
                await cliS3Operation({
                    S3Operation: 'cp',
                    SourceBucket: message.MessageAttributes.Bucket.StringValue,
                    TargetBucket: message.MessageAttributes.TargetBucket.StringValue,
                    Path: message.MessageAttributes.Path.StringValue
                });
                break;
            case 'directory':
                await cliS3Operation({
                    S3Operation: 'sync',
                    SourceBucket: message.MessageAttributes.Bucket.StringValue,
                    TargetBucket: message.MessageAttributes.TargetBucket.StringValue,
                    Path: message.MessageAttributes.Path.StringValue
                });
                break;
        };
    }
});

consumer.on('error', (err) => {
    console.error('Cannot start, missing input queue URL or credentials?');
    console.log(err);
    process.exit(1);
})

consumer.on('processing_error', (err) => {
    console.log(err);
    process.exit(1);
})

consumer.on('empty', function() {
    console.log('queue empty, exiting');
    process.exit(0);
});

consumer.start();