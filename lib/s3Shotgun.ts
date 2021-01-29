import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as sqs from '@aws-cdk/aws-sqs';
import * as lambda from '@aws-cdk/aws-lambda-nodejs';
import * as targets from "@aws-cdk/aws-events-targets";
import { Duration } from '@aws-cdk/core';
import { ManagedPolicy, Role, ServicePrincipal } from '@aws-cdk/aws-iam';
import { Rule, RuleTargetInput, Schedule } from '@aws-cdk/aws-events';
import { RetentionDays } from '@aws-cdk/aws-logs';
import { GatewayVpcEndpointAwsService } from '@aws-cdk/aws-ec2';

export class s3Shotgun extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // vpc
    const vpc = new ec2.Vpc(this, 's3ShotgunVpc', {
      cidr: '10.0.0.0/16',
      maxAzs: 99,
      subnetConfiguration: [
        {
          cidrMask: 22,
          name: 's3ShotgunVpc',
          subnetType: ec2.SubnetType.PUBLIC
        }
      ]
    });

    vpc.addGatewayEndpoint('s3endpoint', {
      service: GatewayVpcEndpointAwsService.S3
    })

    // IAM roles
    const taskRole = new Role(this, 's3ShotgunTaskRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: 's3ShotgunTaskRole',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')
      ]
    });

    const executionRole = new Role(this, 's3ShotgunExecutionRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: 's3ShotgunExecutionRole',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')
      ]
    });

    const lambdaRole = new Role(this, 's3ShotgunLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      roleName: 's3ShotgunLambdaRole',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSQSFullAccess'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonECS_FullAccess'),
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });



    // ecs cluster
    const cluster = new ecs.Cluster(this, 's3ShotgunCluster', {
      vpc: vpc,
      containerInsights: false
    });

    // containers
    const s3dfs = ecs.ContainerImage.fromAsset('./assets/docker/s3ShotgunDFS');
    const s3shotgun = ecs.ContainerImage.fromAsset('./assets/docker/s3ShotgunConsumeQueue')

    // queues
    const sqsBuckets = new sqs.Queue(this, 's3ShotgunBucketsQueue', {
      queueName: 's3ShotgunBucketsQueue',
      retentionPeriod: Duration.days(3)
    });

    const sqsPaths = new sqs.Queue(this, 's3ShotgunPathsQueue', {
      queueName: 's3ShotgunPathsQueue',
      retentionPeriod: Duration.days(3)
    });

    executionRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['sqs:*'],
      resources: [
        sqsBuckets.queueArn,
        sqsPaths.queueArn
      ]
    }));
    taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['sqs:*'],
      resources: [
        sqsBuckets.queueArn,
        sqsPaths.queueArn
      ]
    }));

    // S3 DFS task
    const s3DfsTask = new ecs.FargateTaskDefinition(this, 'IndexDFSTask', {
      taskRole: taskRole,
      executionRole: executionRole
    });

    s3DfsTask.addContainer('s3ShotgunDFS', {
      image: s3dfs,
      command: [
        's3Dfs',
        '-b',
        sqsBuckets.queueUrl,
        '-q',
        sqsPaths.queueUrl,
        '-t',
        `${process.env.TARGET_BUCKET}`
      ],
      logging: new ecs.AwsLogDriver({
        streamPrefix: 's3ShotgunDFS',
        logRetention: 3
      })
    });

    // S3 Shotgun task
    const s3ShotgunConsumerTask = new ecs.FargateTaskDefinition(this, 'ConsumerTask', {
      taskRole: taskRole,
      executionRole: executionRole
    });

    s3ShotgunConsumerTask.addContainer('s3ShotgunConsumer', {
      image: s3shotgun,
      command: [
        'consumeQueue',
        sqsPaths.queueUrl
      ],
      logging: new ecs.AwsLogDriver({
        streamPrefix: 's3ShotgunConsumer',
        logRetention: 3
      })
    });

    // task scaler lambda
    var subnetIds = new Array<string>();
    for (let subnet in vpc.publicSubnets) {
      subnetIds.push(vpc.publicSubnets[subnet].subnetId);
    };

    const scalerLambda = new lambda.NodejsFunction(this, 's3shotgunScaler', {
      role: lambdaRole,
      entry: './assets/lambda/ecsTaskLauncher/ecsTasker.js',
      handler: 'handler',
      depsLockFilePath: './assets/lambda/ecsTaskLauncher/package-lock.json',
      timeout: Duration.minutes(5),
      logRetention: RetentionDays.THREE_DAYS
    });

    // cloudwatch event rule to check queues every minute
    const rule = new Rule(this, 'lambdaSchedule', {
      schedule: Schedule.rate(Duration.minutes(1)),
    })

    rule.addTarget(new targets.LambdaFunction(scalerLambda, {
      event: RuleTargetInput.fromObject({
        'sqsUrl': sqsPaths.queueUrl,
        'ecsCluster': cluster.clusterArn,
        'maxTasks': '500',
        'maxBacklog': '100',
        'tasksStepping': '10',
        'taskDefinition': s3ShotgunConsumerTask.taskDefinitionArn,
        'subnetIds': subnetIds.join()
      })
    }));

    rule.addTarget(new targets.LambdaFunction(scalerLambda, {
      event: RuleTargetInput.fromObject({
        'sqsUrl': sqsBuckets.queueUrl,
        'ecsCluster': cluster.clusterArn,
        'maxTasks': '10',
        'maxBacklog': '1',
        'tasksStepping': '10',
        'taskDefinition': s3DfsTask.taskDefinitionArn,
        'subnetIds': subnetIds.join()
      })
    }));

  }
};
