'use strict';
var log4js = require('log4js');
var logger = log4js.getLogger('SampleWebApp');
var express = require('express');
var bodyParser = require('body-parser');
var http = require('http');
var util = require('util');
var app = express();
var expressJWT = require('express-jwt');
var jwt = require('jsonwebtoken');
var bearerToken = require('express-bearer-token');
var cors = require('cors');
var path = require('path');
const dotenv = require('dotenv');
dotenv.config({path: '.env'});
logger.debug('env data----------->',process.env);
var host = process.env.HOST || "localhost";
var port = process.env.PORT || "8002";
///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// SET CONFIGURATONS ////////////////////////////
///////////////////////////////////////////////////////////////////////////////
app.options('*', cors());
app.use(cors());
//support parsing of application/json type post data
app.use(bodyParser.json());
//support parsing of application/x-www-form-urlencoded post data
app.use(bodyParser.urlencoded({
	extended: false
}));
// set secret variable
app.set('secret', 'thisismysecret');

app.use(expressJWT({
	secret: 'thisismysecret'
}).unless({
	path: ['/users']
}));

app.use(bearerToken());

app.use(function(req, res, next) {
	logger.debug(' ------>>>>>> new request for %s',req.originalUrl);
	if (req.originalUrl.indexOf('/users') >= 0) {
		return next();
	}

	var token = req.token;
	jwt.verify(token, app.get('secret'), function(err, decoded) {
		if (err) {
			res.send({
				success: false,
				message: 'Failed to authenticate token. Make sure to include the ' +
					'token returned from /users call in the authorization header ' +
					' as a Bearer token'
			});
			return;
		} else {
			// add the decoded user name and org name to the request object
			// for the downstream code to use
			req.username = decoded.username;
			req.orgname = decoded.orgName;
			logger.debug(util.format('Decoded from JWT token: username - %s, orgname - %s', decoded.username, decoded.orgName));
			return next();
		}
	});
});

///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// START SERVER /////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
var server = http.createServer(app).listen(port, function() {});
logger.info('****************** SERVER STARTED ************************');
logger.info('***************  http://%s:%s  ******************',host,port);
server.timeout = 240000;

function getErrorMessage(field) {
	var response = {
		success: false,
		message: field + ' field is missing or Invalid in the request'
	};
	return response;
}


///////////////////////////////////////////////////////////////////////////////
///////////////////////// REST ENDPOINTS START HERE ///////////////////////////
///////////////////////////////////////////////////////////////////////////////
//////////////////////////
const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const { buildCAClient, registerAndEnrollUser } = require('./app/CAUtil');
const { buildCCP, buildWallet } = require('./app/AppUtil.js');



function prettyJSONString(inputString) {
	return JSON.stringify(JSON.parse(inputString), null, 2);
}

app.post('/users', async function (req, res) {
	var username = req.body.username
	var orgName = req.body.orgName
	var attributes = req.body.attributes
	logger.debug('End point : /users')
	logger.debug('User name : ' + username)
	logger.debug('Org name  : ' + orgName)
	logger.debug('attributes  : ' + attributes)
	if (!username) {
	  res.json(getErrorMessage('\'username\''))
	  return
	}
	if (!orgName) {
	  res.json(getErrorMessage('\'orgName\''))
	  return
	}
	if (!attributes) {
	  attributes = []
	} else {
	  for (var a = 0; a < attributes.length; a++) {
		attributes[a].ecert = true
	  }
	}
	var token = jwt.sign({
	  exp: Math.floor(Date.now() / 1000) + parseInt(process.env.JWT_EXPIRYTIME),
	  username: username,
	  orgName: orgName
	}, app.get('secret'))
	const walletPath = path.join(__dirname, orgName.toLowerCase()+'wallet');
	const orgMSP= orgName.includes('.')?orgName.split('.')[0]+'MSP':orgName+'MSP';
	const ccp = await buildCCP(orgName);
	console.log('ccp--->',JSON.stringify(ccp))
	// build an instance of the fabric ca services client based on
	// the information in the network configuration
	const caClient = buildCAClient(FabricCAServices, ccp, 'ca.'+orgName.toLowerCase()+'.example.com');

	// setup the wallet to hold the credentials of the application user
	const wallet = await buildWallet(Wallets, walletPath);

	// in a real application this would be done on an administrative flow, and only once
	//await enrollAdmin(caClient, wallet, orgMSP);

	// in a real application this would be done only when a new user was required to be added
	// and would be part of an administrative flow
	let response = await registerAndEnrollUser(caClient, wallet, orgMSP, username, 'org1.department1',attributes);

  
	logger.debug('-- returned from registering the username %s for organization %s', username, orgName)
	if (response && typeof response !== 'string') {
	  logger.debug('Successfully registered the username %s for organization %s', username, orgName)
	  response.token = token
	  res.json(response)
	} else {
	  logger.debug('Failed to register the username %s for organization %s with::%s', username, orgName, response)
	  res.json({ success: false, message: response })
	}
  })

  
app.post('/api/transactions', async function(req, res) {
	try {
		const chaincodeName = req.headers.chaincodename
		const channelName = req.headers.channelname
		const username = req.username
		const orgName = req.orgname
		var fcn = req.body.fcn
		var args = req.body.args
		const walletPath = path.join(__dirname, orgName.toLowerCase()+'wallet');
		// build an in memory object with the network configuration (also known as a connection profile)
		const ccp = await buildCCP(orgName);

		// setup the wallet to hold the credentials of the application user
		const wallet = await buildWallet(Wallets, walletPath);
		// Create a new gateway instance for interacting with the fabric network.
		// In a real application this would be done as the backend server session is setup for
		// a user that has been verified.
		const gateway = new Gateway();

		try {
			// setup the gateway instance
			// The user will now be able to create connections to the fabric network and be able to
			// submit transactions and query. All transactions submitted by this gateway will be
			// signed by this user using the credentials stored in the wallet.
			await gateway.connect(ccp, {
				wallet,
				identity: username,
				discovery: { enabled: true, asLocalhost: true } // using asLocalhost as this gateway is using a fabric network deployed locally
			});
			console.log('----',gateway);
			// Build a network instance based on the channel where the smart contract is deployed
			const network = await gateway.getNetwork(channelName);
			console.log('network---',network);
			// Get the contract from the network.
			const contract = await network.getContract(chaincodeName);
			console.log('\n--> Submit Transaction: CreateAsset, creates new asset with ID, color, owner, size, and appraisedValue arguments');
			var resp= await contract.submitTransaction(fcn, ...args);
			console.log('*** Result: committed',resp.toString());
			res.send(resp.toString());
		} finally {
			// Disconnect from the gateway when the application is closing
			// This will close all connections to the network
			gateway.disconnect();
		}
	} catch (error) {
		console.error(`******** FAILED to run the application: ${error}`);
	}
})

app.get('/api/transactions', async function(req, res) {
	try {
		const chaincodeName = req.headers.chaincodename
		const channelName = req.headers.channelname
		const username = req.username
		const orgName = req.orgname
		const walletPath = path.join(__dirname, orgName.toLowerCase()+'wallet');
		const args = req.query.args
		const fcn = req.query.fcn
		console.log('args----',args);
		// build an in memory object with the network configuration (also known as a connection profile)
		const ccp = await buildCCP(orgName);

		// setup the wallet to hold the credentials of the application user
		const wallet = await buildWallet(Wallets, walletPath);
		// Create a new gateway instance for interacting with the fabric network.
		// In a real application this would be done as the backend server session is setup for
		// a user that has been verified.
		const gateway = new Gateway();

		try {
			// setup the gateway instance
			// The user will now be able to create connections to the fabric network and be able to
			// submit transactions and query. All transactions submitted by this gateway will be
			// signed by this user using the credentials stored in the wallet.
			await gateway.connect(ccp, {
				wallet,
				identity: username,
				discovery: { enabled: true, asLocalhost: true } // using asLocalhost as this gateway is using a fabric network deployed locally
			});
			console.log('gateway-----',gateway);
			// Build a network instance based on the channel where the smart contract is deployed
			const network = await gateway.getNetwork(channelName);
			console.log("network----",network)
			// Get the contract from the network.
			const contract = await network.getContract(chaincodeName);
			console.log('contract----',contract);
			//console.log('\n--> Evaluate Transaction: ReadAsset, function returns an asset with a given assetID');
			var result = await contract.evaluateTransaction(fcn, ...args);
			console.log(`*** Result: ${result}`);
			res.send(result);
		} finally {
			// Disconnect from the gateway when the application is closing
			// This will close all connections to the network
			gateway.disconnect();
		}
	} catch (error) {
		console.error(`******** FAILED to run the application: ${error}`);
	}
})

