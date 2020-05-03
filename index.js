var Service;
var Characteristic;

const request = require('request');

const DEF_MIN_OPEN = 0,
	DEF_MAX_OPEN = 100,
	DEF_TIMEOUT = 5000;

module.exports = homebridge => {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerAccessory(
		"homebridge-http-window-blinds-pattern",
		"HttpWindowBlindsPattern",
		HttpWindowBlindsPattern);
};

function extractValueFromPattern(pattern, string, position = 1) {
	const matchArray = string.match(pattern);

	if (matchArray === null) // pattern didn't match at all
		throw new Error(`Pattern didn't match (value: '${string}', pattern: '${pattern}')`);
	else if (position >= matchArray.length)
		throw new Error("Couldn't find any group which can be extracted. The specified group from which the data should be extracted was out of bounds");
	else
		return matchArray[position];
}

function HttpWindowBlindsPattern(log, config) {
	this.service = new Service.WindowCovering(this.name);
	this.log = log;
	this.debug = config.debug || false;
	this.name = config.name || "Window Blinds";
	this.model = config["model"] || "nodeMCU based DIY motorised blinds";
	this.manufacturer = "@carlosfrutos";
	this.outputValueMultiplier = config.outputValueMultiplier || 1;
	this.urlSetTargetPosition = config.urlSetTargetPosition;
	this.urlGetCurrentPosition = config.urlGetCurrentPosition;
	this.statusPattern = "([0-9]+)";
	if (config.statusPattern) {
		if (typeof config.statusPattern === "string")
			this.statusPattern = new RegExp(config.statusPattern);
		else
			this.log.warn("Property 'statusPattern' was given in an unsupported type. Using default one! (%s)", this.statusPattern);
	}
	this.matchingGroup = 1;
	if (config.matchingGroup) {
		if (typeof config.matchingGroup === "int")
			this.matchingGroup = config.matchingGroup;
		else
			this.log.warn("Property 'matchingGroup' was given in an unsupported type. Using default one! (%s)", this.matchingGroup);
	}
	this.serial = config["serial"] || "HWB02";
	this.timeout = config["timeout"] || DEF_TIMEOUT;
	this.minOpen = config["min_open"] || DEF_MIN_OPEN;
	this.maxOpen = config["max_open"] || DEF_MAX_OPEN;

	this.currentPosition = 0;
	this.targetPosition = 100;

	this.positionState = Characteristic.PositionState.STOPPED;
	this.service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
}

HttpWindowBlindsPattern.prototype = {
	identify: function (callback) {
		this.log("Identify requested!");
		callback(null);
	},

	getName: function (callback) {
		this.log("getName :", this.name);
		callback(null, this.name);
	},

	getCurrentPosition: function (callback) {
		var ops = {
			uri: this.urlGetCurrentPosition,
			method: "GET",
			timeout: this.timeout
		};
		//GetCode here
		request(ops, (error, response, body) => {
			var value = null;
			if (error) {
				this.log(`HTTP bad response (${ops.uri}): ${error.message}`);
			} else {
				try {
					//value = JSON.parse(body).position;
					matches = this.statusPattern.exec(body);
					value = matches[this.matchingGroup];
					if (this.debug)
						this.log(`Matched groups: ${matches}. Window blind's current position is ${matches[this.matchingGroup]}`);
					if (value < this.minOpen || value > this.maxOpen || isNaN(value)) {
						throw "Invalid value received";
					}
					this.log('HTTP successful response: ' + body);
					this.currentPosition = value;
					this.service.setCharacteristic(Characteristic.CurrentPosition, this.currentPosition);
					this.service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);

				} catch (parseErr) {
					this.log(`Error processing received information: ${parseErr.message} body: ${body}`);
					error = parseErr;

				}
			}
			callback(error, this.currentPosition);
		});
	},
	getTargetPosition: function (callback) {
		this.log("getTargetPosition :", this.targetPosition);
		this.service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
		callback(null, this.targetPosition);
	},
	setTargetPosition: function (value, callback) {
		this.log("setTargetPosition from %s to %s", this.targetPosition, value);
		this.targetPosition = value;

		if (this.targetPosition > this.currentPosition) {
			this.service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.INCREASING);
		} else if (this.targetPosition < this.currentPosition) {
			this.service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.DECREASING);
		} else if (this.targetPosition = this.currentPosition) {
			this.service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
		}

		request((this.urlSetTargetPosition.replace('%VALUE%', Math.round(value * this.outputValueMultiplier))), (error, response, body) => {
			this.currentPosition = this.targetPosition;
			this.service.setCharacteristic(Characteristic.CurrentPosition, this.currentPosition);
			this.service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
			this.log("currentPosition is now %s", this.currentPosition);
			callback(null);
		});
	},
	getPositionState: function (callback) {
		this.log("getPositionState :", this.positionState);
		callback(null, this.positionState);
	},
	getServices: function () {
		var informationService = new Service.AccessoryInformation();

		informationService
			.setCharacteristic(Characteristic.Manufacturer, "Peter Chodyra & Carlos Frutos")
			.setCharacteristic(Characteristic.Model, "HTTP Window Blinds")
			.setCharacteristic(Characteristic.SerialNumber, "HWB02");

		this.service
			.getCharacteristic(Characteristic.Name)
			.on('get', this.getName.bind(this));

		this.service
			.getCharacteristic(Characteristic.CurrentPosition)
			.on('get', this.getCurrentPosition.bind(this));

		this.service
			.getCharacteristic(Characteristic.TargetPosition)
			.on('get', this.getTargetPosition.bind(this))
			.on('set', this.setTargetPosition.bind(this));

		this.service
			.getCharacteristic(Characteristic.PositionState)
			.on('get', this.getPositionState.bind(this));

		return [informationService, this.service];
	}
}