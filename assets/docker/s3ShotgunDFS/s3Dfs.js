const aws = require('aws-sdk');
const getPaginatedResults = require('./paginator')

const s3 = new aws.S3({region: 'eu-west-1'});
const MAXDEPTH = 6;

const sendPathsToQueue = async(params) => {
    const sqs = new aws.SQS();
    let pathArray = Array.from(params.PathsSet);
    let promises = [];
    while (pathArray.length > 0) {
        var entries = [];
        for (let i = 0; i < 10 && i < pathArray.length; i++) { // 10 is max size of SQS batch
            singlePath = pathArray.pop();
            var hrTime = process.hrtime();
            timestamp = hrTime[0] * 1000000 + hrTime[1];
            entries.push({
                Id: timestamp.toString(),
                MessageBody: `Path added ${timestamp}`,
                MessageAttributes: {
                    'Bucket': {
                        DataType: 'String',
                        StringValue: params.Bucket
                    },
                    'TargetBucket': {
                        DataType: 'String',
                        StringValue: params.TargetBucket
                    },

                    'Path': {
                        DataType: 'String',
                        StringValue: singlePath
                    },
                    'PathType': {
                        DataType: 'String',
                        StringValue: params.PathType
                    }
                },
                MessageBody: singlePath,
            });
        };
        batchParams = {
            Entries: entries,
            QueueUrl: params.QueueUrl
        }

        promises.push(sqs.sendMessageBatch(batchParams).promise());
    };
    const results = await Promise.all(promises);

    sqs.getQueueAttributes(
        {QueueUrl: params.QueueUrl, AttributeNames: [ 'ApproximateNumberOfMessages' ]},
        function(err, data) {
            if (err) console.log(err);
            else {
                console.log(data);
            }
        }
    )
}

const getAllObjects = async(params) => {
    let f;
    await getPaginatedResults(async (NextMarker) => {
        f = await s3.listObjectsV2({
            Bucket: params.Bucket,
            ContinuationToken: NextMarker,
            Prefix: params.Prefix,
            Delimiter: '/'
        }).promise();
        return {
            marker: f.NextContinuationToken,
            results: f.Contents
        }
    });
    return f;
};

const getS3ObjectsDepth = async(params, depth = 0) => {
    let folderContent = {
        folders: new Set(),
        files: new Set()
    }

    let f = await getAllObjects(params);
    f.Contents.forEach(element => {
        if (!element.Key.endsWith('/')) {
            folderContent.files.add(element.Key);
        };
    });
    if (f.CommonPrefixes.length > 0 && depth < MAXDEPTH) {
        let contents = await Promise.all(f.CommonPrefixes.map(async (path) => {
            let currDepth = depth;
            return getS3ObjectsDepth(
                {
                    Bucket: params.Bucket,
                    Prefix: path.Prefix,
                    Delimiter: '/'
                }, ++currDepth
            );
        }))
        contents.forEach(fc => {
            folderContent.folders = new Set([...folderContent.folders, ...fc.folders]);
            folderContent.files = new Set([...folderContent.files, ...fc.files]);
        })
    } else {
        if (f.CommonPrefixes) {
            f.CommonPrefixes.forEach(element => {
                folderContent.folders.add(element.Prefix);
            })
        }
        f.Contents.forEach(element => {
            if (element.Key.endsWith('/')) {
                folderContent.folders.add(element.Key);
            } else {
                folderContent.files.add(element.Key)
            }
        });
    };
    return folderContent;
}

async function getS3Bucket(BucketQueueUrl) {
    const sqs = new aws.SQS();
    const sqsParams = {
        QueueUrl: BucketQueueUrl,
        MessageAttributeNames: [ 'All' ]
    }
    let message = await sqs.receiveMessage(sqsParams).promise();
    if (message.Messages) {
        await sqs.deleteMessage(
            {
                QueueUrl: sqsParams.QueueUrl,
                ReceiptHandle: message.Messages[0].ReceiptHandle
            }
        ).promise();
        return message.Messages[0].MessageAttributes.Bucket.StringValue;
    } else return null;
}

async function run(event, context) {
    let bucket;
    do {
        bucket = await getS3Bucket(event.BucketQueueUrl);
        if (bucket) {
            const results = await getS3ObjectsDepth({
                Bucket: bucket,
                Prefix: event.Prefix
            })
            // console.log('RESULTS: ', results);

            // send folder paths to queue
            await sendPathsToQueue({
                Bucket: bucket,
                TargetBucket: event.TargetBucket,
                PathsSet: results.folders,
                QueueUrl: event.QueueUrl,
                PathType: 'directory'
            });
            // send stray file paths to queue
            await sendPathsToQueue({
                Bucket: bucket,
                TargetBucket: event.TargetBucket,
                PathsSet: results.files,
                QueueUrl: event.QueueUrl,
                PathType: 'file'
            })
        }
    } while (bucket);
};

try {
    const args = require('minimist')(process.argv.slice(2), {
        alias: {
            help: 'h',
            BucketQueueUrl: 'b',
            Prefix: 'p',
            QueueUrl: 'q',
            TargetBucket: 't'
        },
        default: {
            Prefix: ''
        }
    });

    if (args.h || !process.argv[2]) {
        console.log('\nUsage: node s3Dfs --TargetBucket [s3Bucket] --BucketQueueUrl [sqsUrl] --QueueUrl [sqsUrl] (Optional: --Prefix [s3bucketPrefix])',
        '\nExample:\n\nnode app.js \\\n\t--TargetBucket example-bucket \\\n\t--BucketQueueUrl https://sqs.eu-west-1.amazonaws.com/123456789012/bucketsToSyncQueue \\\n\t--QueueUrl https://sqs.eu-west-1.amazonaws.com/123456789012/s3PathsQueue \\\n\t--Prefix 2021-01-10 ');
        process.exit(0);
    }

    requiredArgs = ['BucketQueueUrl', 'QueueUrl', 'TargetBucket'];
    requiredArgs.forEach(element => {
        if (!args[element]) {
            console.log(`Missing argument ${element}, see --help for required arguments and options`)
            process.exit(1);
        }
    })

    run({
        BucketQueueUrl: args.BucketQueueUrl,
        Prefix: args.Path,
        QueueUrl: args.QueueUrl,
        TargetBucket: args.TargetBucket
    }, null)

} catch (err) {
    console.log(err);
};