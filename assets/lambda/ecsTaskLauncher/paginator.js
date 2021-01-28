const AWS = require('aws-sdk');

// https://advancedweb.hu/how-to-paginate-the-aws-js-sdk-using-async-generators/

// Example usage for Lambda:
// const lambdas = await getPaginatedResults(async (NextMarker) => {
// 	const functions = await lambda.listFunctions({Marker: NextMarker}).promise();
// 	return {
// 		marker: functions.NextMarker,
// 		results: functions.Functions,
// 	};
// });

// Example usage for Cloudwatch:
// const logGroups = await getPaginatedResults(async (NextMarker) => {
// 	const logGroups = await logs.describeLogGroups({nextToken: NextMarker}).promise();
// 	return {
// 		marker: logGroups.nextToken,
// 		results: logGroups.logGroups,
// 	};
// });

// Example usage for Organizations:
// const accounts = await getPaginatedResults(async (NextMarker) => {
//     const accs = await org.listAccounts({NextToken: NextMarker}).promise();
//     return {
//         marker: accs.NextToken,
//         results: accs.Accounts
//     };
// });

let getPaginatedResults = async (fn) => {
	const EMPTY = Symbol('empty');
	const res = [];
	for await (const lf of (async function*() {
		let NextMarker = EMPTY;
		while (NextMarker || NextMarker === EMPTY) {
			const {marker, results} = await fn(NextMarker !== EMPTY ? NextMarker : undefined);

			yield* results;
			NextMarker = marker;
		}
	})()) {
		res.push(lf);
	}

	return res;
};

module.exports = getPaginatedResults;