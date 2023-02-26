"use strict";

/*
 * Created with @iobroker/create-adapter v2.3.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const { info } = require("console");
const adapterHelpers = require("iobroker-adapter-helpers"); // Lib used for Unit calculations

let methodName = "";
let delay = null; // Global array for all running timers
let calcBlock = null; // Global variable to block all calculations
const stateDeletion = true;
const myValue = 0;
const myTempValue = 1;
const myCalcMode = 2;
const stateNames = { 0: "consumption.dataValue", 1: "consumption.tempValue", 2: "consumption.calcMode" };
const stateDescr = { 0: "Consumption", 1: "Temporary Value", 2: "Calculation-Mode" };

class DeltaConsumption extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "delta-consumption",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("objectChange", this.onObjectChange.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
		// Unit and price definitions, will be loaded at adapter start.
		this.unitDef = {
			unitConfig: {},
		};
		this.activeStates = {}; // Array of activated states for Delta-Consumption
		this.validStates = {}; // Array of all created states
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here
		// Info due starting the adapter
		this.log.info("Get Delta-Consumption prepare to work ...");
		// Block all calculation functions during startup
		calcBlock = true;
		// Load Unit definitions from helper library & prices from admin to workable memory array
		await this.definitionLoader();
		// Get all objects with custom configuration items
		const customStateArray = await this.getObjectViewAsync("system", "custom", {});
		this.log.debug(`[onReady] All states with custom items : ${JSON.stringify(customStateArray)}`);
		// List all states with custom configuration
		if (customStateArray && customStateArray.rows) {
			// Verify first if result is not empty
			// Loop truth all states and check if state is activated for EC
			for (const index in customStateArray.rows) {
				const myObject = customStateArray.rows[index].value;
				if (myObject != null) {
					// Avoid crash if object is null or empty
					// Check if custom object contains data for EC
					if (myObject[this.namespace]) {
						this.log.debug(
							"[onReady] Delta-Consumption configuration found for " + customStateArray.rows[index].id,
						);
						// Check if custom object is enabled for Delta-Consumption
						if (myObject[this.namespace].enabled) {
							// Simplify stateID
							const stateID = customStateArray.rows[index].id;
							// Prepare array in constructor for further processing
							this.activeStates[stateID] = {};
							this.log.debug("[onReady] Delta-Consumption enabled state found " + stateID);
						} else {
							this.log.debug(
								"[onReady] Delta-Consumption configuration found but not Enabled, skipping ${stateID}",
							);
						}
					} else {
						console.log("No Delta-Consumption configuration found");
					}
				}
			}
		}
		const totalEnabledStates = Object.keys(this.activeStates).length;
		let totalInitiatedStates = 0;
		let totalFailedStates = 0;
		this.log.info(`Found ${totalEnabledStates} Delta-Consumption enabled states`);
		// Initialize all discovered states
		let count = 1;
		for (const stateID in this.activeStates) {
			this.log.info(`Initialising (${count}/${totalEnabledStates}) "${stateID}"`);
			await this.buildStateDetailsArray(stateID);
			if (this.activeStates[stateID]) {
				await this.initialize(stateID);
				totalInitiatedStates = totalInitiatedStates + 1;
				this.log.info(`Initialization (${count}/${totalEnabledStates}) for ${stateID} successfully`);
			} else {
				this.log.error(`[onReady] Initialization of ${stateID} failed, check warn messages !`);
				totalFailedStates = totalFailedStates + 1;
			}
			count = count + 1;
		}
		// Subscribe on all foreign objects to detect (de)activation of Electric Consumption enabled states
		this.log.debug("[onReady] subscribeForeignObjects ...");
		this.subscribeForeignObjects("*");
		// Enable all calculations with timeout of 500 ms
		if (delay) {
			clearTimeout(delay);
			delay = null;
		}
		delay = setTimeout(function () {
			calcBlock = false;
		}, 500);
		if (totalFailedStates > 0) {
			this.log.warn(
				`Cannot handle calculations for ${totalFailedStates} of ${totalEnabledStates} enabled states, check error messages`,
			);
		}
		this.log.info(
			`Successfully activated Delta-Consumption for ${totalInitiatedStates} of ${totalEnabledStates} states, will do my Job until you stop me!`,
		);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);

			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		// this.log.error("[onStateChange] START");
		if (calcBlock) return; // cancel operation if global calculation block is activate
		try {
			// Check if a valid state change has been received
			if (state) {
				// The state was changed
				this.log.debug(
					`[onStateChange] state ${id} changed : ${JSON.stringify(
						state,
					)} Delta-Consumption calculation executed`,
				);
				//ToDo: Implement x ignore time (configurable) to avoid overload of unneeded calculations
				// Avoid unneeded calculation if value is equal to known value in memory

				// Handle calculation for state
				// Check if for some reason calculation handler ist called for an object not initialised
				if (this.activeStates[id]) {
					this.calculationHandler(id, state);
				} else {
					this.log.debug(`[onStateChange] state not initialised, calculation cancelled]`);
				}
			} else {
				this.log.debug(`[onStateChange] Update of state ${id} received with equal value ${state.val} ignoring`);
			}
		} catch (error) {
			this.errorHandling(`[onStateChange] for ${id}`, error);
		}
		if (state) {
			// The state was changed
			// this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
		// this.log.error("[onStateChange] END");
	}

	/**
	 * Load calculation factors from helper library and store to memory
	 */
	async definitionLoader() {
		// this.log.debug("[definitionLoader] START");
		try {
			// Load energy array and store exponents related to unit
			const catArray = ["Watt", "Watt_hour", "W"];
			const unitStore = this.unitDef.unitConfig;
			for (const item in catArray) {
				const unitItem = adapterHelpers.units.electricity[catArray[item]];
				for (const unitCat in unitItem) {
					// this.log.debug(`[definitionLoader] Einheit ${unitItem[unitCat].unit}`);
					unitStore[unitItem[unitCat].unit] = {
						exponent: unitItem[unitCat].exponent,
						category: catArray[item],
					};
				}
			}
		} catch (error) {
			this.errorHandling(methodName, error);
		}
		// this.log.debug("[definitionLoader] END");
	}

	/**
	 * @param {string} [codePart]- Message Prefix
	 * @param {object} [error] - Sentry message
	 */
	errorHandling(codePart, error) {
		const msg = `[${codePart}] error: ${error.message}, stack: ${error.stack}`;
		// if (!disableSentry) {
		// 	if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
		// 		const sentryInstance = this.getPluginInstance('sentry');
		// 		if (sentryInstance) {
		// 			this.log.info(`[Error caught and sent to Sentry, thank you for collaborating!] error: ${msg}`);
		// 			sentryInstance.getSentryObject().captureException(msg);
		// 		}
		// 	}
		// } else {
		// 	this.log.error(`Sentry disabled, error caught : ${msg}`);
		// 	console.error(`Sentry disabled, error caught : ${msg}`);
		// }
		this.log.error(`Error caught : ${msg}`);
		console.error(`Error caught : ${msg}`);
	}

	/**
	 * Load state definitions to memory this.activeStates[stateID]
	 * @param {string} stateID ID  of state to refresh memory values
	 */
	async buildStateDetailsArray(stateID) {
		let initError = false;
		this.log.debug(`[buildStateDetailsArray] START for ${stateID}`);
		try {
			let stateInfo;
			try {
				// Load configuration as provided in object
				stateInfo = await this.getForeignObjectAsync(stateID);
				if (!stateInfo) {
					this.log.error(
						`[buildStateDetailsArray] Can't get information for ${stateID}, state will be ignored`,
					);
					delete this.activeStates[stateID];
					this.unsubscribeForeignStates(stateID);
					return;
				}
			} catch (error) {
				this.log.error(`${stateID} is incorrectly correctly formatted, ${JSON.stringify(error)}`);
				delete this.activeStates[stateID];
				this.unsubscribeForeignStates(stateID);
				return;
			}
			// Replace not allowed characters for state name
			const newDeviceName = stateID.split(".").join("_");
			// Check if configuration for Electric Consumption is present, trow error in case of issue in configuration
			if (stateInfo && stateInfo.common && stateInfo.common.custom && stateInfo.common.custom[this.namespace]) {
				const customData = stateInfo.common.custom[this.namespace];
				const commonData = stateInfo.common;
				this.log.debug(`[buildStateDetailsArray] commonData ${JSON.stringify(commonData)}`);
				this.log.debug(`[buildStateDetailsArray] customData ${JSON.stringify(customData)}`);
				let useUnit = "";
				if (commonData.unit && commonData.unit !== "") {
					useUnit = commonData.unit;
					this.log.debug(`[buildStateDetailsArray] Unit detected ${JSON.stringify(useUnit)}`);
				} else {
					this.log.error(`[buildStateDetailsArray] No unit detected`);
					initError = true;
				}
				if (useUnit !== "W") {
					this.log.error(
						`[buildStateDetailsArray] Wrong unit ${JSON.stringify(useUnit)} deteced. Only Watt allowed.`,
					);
				}
				if (initError) {
					this.log.error(
						`Cannot handle calculations for ${stateID}, check log messages and adjust settings!`,
					);
					delete this.activeStates[stateID];
					this.unsubscribeForeignStates(stateID);
					return;
				}
				// Load state settings to memory
				this.activeStates[stateID] = {
					stateDetails: {
						alias: customData.alias !== "" ? customData.alias : "",
						deviceName: newDeviceName.toString(),
						name: stateInfo.common.name !== "" ? customData.alias : "No name known, please provide alias",
						stateUnit: useUnit,
						useUnit: "kWh",
					},
					calcValues: {
						startValue: customData.startValue,
						endValue: customData.endValue,
					},
				};
				this.log.debug(
					`[buildStateDetailsArray] completed for ${stateID}: with content ${JSON.stringify(
						this.activeStates[stateID],
					)}`,
				);
			}
		} catch (error) {
			this.errorHandling(`[buildStateDetailsArray] ${stateID}`, error);
		}
		this.log.debug(`[buildStateDetailsArray] END for ${stateID}`);
	}

	// Create object tree and states for all devices to be handled
	async initialize(stateID) {
		methodName = "[initialize]";
		this.log.debug(
			`[initialize] START : Initialising ${stateID} with configuration ${JSON.stringify(
				this.activeStates[stateID],
			)}`,
		);
		// Shorten configuration details for easier access
		if (!this.activeStates[stateID]) {
			this.log.error(`[initialize] Cannot handle initialisation for ${stateID}`);
			return;
		}
		const stateDetails = this.activeStates[stateID].stateDetails;
		this.log.debug(
			`[initialize] Defined calculation attributes for ${stateID} : ${JSON.stringify(
				this.activeStates[stateID],
			)}`,
		);
		// Check if alias is used and update object with new naming (if changed)
		let alias = stateDetails.name;
		if (stateDetails.alias && stateDetails.alias !== "") {
			alias = stateDetails.alias;
		} else {
			alias = stateDetails.deviceName;
		}
		// Create Device Object
		await this.extendObjectAsync(stateDetails.deviceName, {
			type: "device",
			common: {
				name: alias,
			},
			native: {},
		});
		// Create state for cumulative reading
		await this.doLocalStateCreate(
			stateID,
			Object.values(stateNames)[myTempValue],
			Object.values(stateDescr)[myTempValue],
			true,
			false,
		);
		await this.doLocalStateCreate(
			stateID,
			Object.values(stateNames)[myTempValue],
			Object.values(stateDescr)[myTempValue],
			false,
			false,
		);
		await this.doLocalStateCreate(
			stateID,
			Object.values(stateNames)[myValue],
			Object.values(stateDescr)[myValue],
			true,
			false,
		);
		await this.doLocalStateCreate(
			stateID,
			Object.values(stateNames)[myValue],
			Object.values(stateDescr)[myValue],
			false,
			false,
		);
		await this.doLocalStateCreate(
			stateID,
			Object.values(stateNames)[myCalcMode],
			Object.values(stateDescr)[myCalcMode],
			true,
			true,
		);
		await this.doLocalStateCreate(
			stateID,
			Object.values(stateNames)[myCalcMode],
			Object.values(stateDescr)[myCalcMode],
			false,
			true,
		);
		// Handle calculation
		const value = await this.getForeignStateAsync(stateID);
		this.log.debug(
			`[initialize] First time calc result after initialising ${stateID}  with value ${JSON.stringify(value)}`,
		);
		if (value) {
			// await this.buildVisWidgetJson(stateID);
			await this.calculationHandler(stateID, value);
		}
		// Subscribe state, every state change will trigger calculation now automatically
		this.subscribeForeignStates(stateID);
		this.log.debug(
			`[initialize] END : ${stateID} with configuration ${JSON.stringify(this.activeStates[stateID])}`,
		);
	}

	/**
	 * Function to handle state creation
	 * @param {string} stateID - RAW state ID of monitored state
	 * @param {string} stateRoot - Root folder location
	 * @param {string} name - Name of state (also used for state ID !
	 * @param {boolean} [deleteState=FALSE] - Set to true will delete the state
	 * @param {boolean} [isBoolean=FALSE] - Create an Bool-Value
	 */
	// await this.doLocalStateCreate(stateID, stateName, "Consumtion", true);
	async doLocalStateCreate(stateID, stateRoot, name, deleteState, isBoolean) {
		this.log.debug(`[doLocalStateCreate] START : ${JSON.stringify(this.activeStates[stateID].name)}`);
		this.log.debug(
			`[doLocalStateCreate] stateDetails : ${JSON.stringify(this.activeStates[stateID].stateDetails)}`,
		);
		const myType = isBoolean ? "boolean" : "number";
		const myDef = isBoolean ? "false" : "0";
		this.log.debug(`[doLocalStateCreate] ${stateID} | TYPE: ${myType}`);
		try {
			const stateDetails = this.activeStates[stateID].stateDetails;
			let commonData = {};
			commonData = {
				name: name,
				type: myType,
				role: "value",
				read: true,
				write: false,
				def: myDef,
			};
			// Define if state should be created at root level
			// Create consumption states
			if (deleteState) {
				this.log.debug(`[doLocalStateCreate] Delete state : ${stateDetails.deviceName}.${stateRoot}`);
				await this.localDeleteState(`${stateDetails.deviceName}.${stateRoot}`);
			} else {
				this.log.debug(`[doLocalStateCreate] Create state : ${stateDetails.deviceName}.${stateRoot}`);
				await this.localSetObject(`${stateDetails.deviceName}.${stateRoot}`, commonData);
			}
		} catch (error) {
			this.errorHandling(`[doLocalStateCreate] ${stateID}`, error);
		}
		this.log.debug(`[doLocalStateCreate] END : ${JSON.stringify(this.activeStates[stateID].name)}`);
	}

	/**
	 * create/extend function for objects
	 * @param {string} stateName - RAW state ID of monitored state
	 * @param {object} commonData - common data content
	 */
	async localSetObject(stateName, commonData) {
		this.validStates[stateName] = commonData;
		await this.setObjectNotExistsAsync(stateName, {
			type: "state",
			common: commonData,
			native: {},
		});
		// Ensure name and unit changes are propagated
		await this.extendObjectAsync(stateName, {
			type: "state",
			common: {
				name: commonData.name,
				unit: commonData.unit,
			},
			native: {},
		});
	}

	/**
	 * proper deletion of state and object
	 * @param {string} stateName - RAW state ID of monitored state
	 */
	async localDeleteState(stateName) {
		try {
			if (stateDeletion) {
				const obj = await this.getObjectAsync(stateName);
				if (obj) {
					await this.delObjectAsync(stateName);
				}
			}
		} catch (error) {
			// do nothing
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	/**
	 * Is called if a subscribed object changes
	 * @param {string} id
	 * @param {ioBroker.Object | null | undefined} obj
	 */
	onObjectChange(id, obj) {
		if (calcBlock) return; // cancel operation if calculation block is activate
		try {
			// this.log.debug("[onObjectChange] START");
			const stateID = id;
			// Check if object is activated for Delta-Consumption
			if (obj && obj.common) {
				// Verify if custom information is available regarding Delta-Consumption
				if (
					obj.common.custom &&
					obj.common.custom[this.namespace] &&
					obj.common.custom[this.namespace].enabled
				) {
					// ignore object changes when caused by SA (memory is handled internally)
					// if (obj.from !== `system.adapter.${this.namespace}`) {
					this.log.debug(
						`[onObjectChange] Object array of Delta-Consumption activated state changed : ${JSON.stringify(
							obj,
						)} stored config : ${JSON.stringify(this.activeStates)}`,
					);
				} else if (this.activeStates[stateID]) {
					delete this.activeStates[stateID];
					this.log.info(`Disabled Delta-Consumption for : ${stateID}`);
					this.log.debug(
						`[onObjectChange] Active state array after deactivation of ${stateID} : ${JSON.stringify(
							this.activeStates,
						)}`,
					);
					this.unsubscribeForeignStates(stateID);
				}
			} else {
				// Object change not related to this adapter, ignoring
			}
			// this.log.debug("[onObjectChange] END");
		} catch (error) {
			this.errorHandling(`${methodName} ${id}}`, error);
		}
		if (obj) {
			// The object was changed
			// Logging deaktiviert <frbr>
			// this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
		} else {
			// The object was deleted
			this.log.info(`object ${id} deleted`);
		}
	}

	/**
	 *Logic to handle all calculations
	 *  @param {string} [stateID] - state id of source value
	 *  @param {object} [stateVal] - object with current value (val) and timestamp (ts)
	 */
	async calculationHandler(stateID, stateVal) {
		try {
			this.log.debug(`[calculationHandler] Calculation for ${stateID} with values : ${JSON.stringify(stateVal)}`);
			this.log.debug(`[calculationHandler] Configuration : ${JSON.stringify(this.activeStates[stateID])}`);
			// Verify if received value is null or undefined
			if (!stateVal) {
				this.log.error(
					`[calculationHandler] Input value for ${stateID} with ${JSON.stringify(
						stateVal,
					)} is null or undefined, cannot continue calculation`,
				);
				return;
			}
			// Verify if received value is null or undefined
			if (!stateID) {
				// Cancel operation when function iis called with empty stateID
				return;
			}
			// Check if for some reason calculation handler ist called for an object not initialised
			const calcValues = this.activeStates[stateID].calcValues;
			const stateDetails = this.activeStates[stateID].stateDetails;
			const currentCath = stateDetails.stateUnit;
			if (!this.activeStates[stateID]) {
				this.errorHandling(`[calculationHandler]`, `Called for non-initialised state ${stateID}`);
				return;
			}
			const startValue = this.activeStates[stateID].calcValues.startValue;
			let myExit = false;
			if (startValue !== null || startValue !== undefined) {
				this.log.debug(`[calculationHandler] Startwert: ${startValue} >= ${JSON.stringify(stateVal.val)}`);
				if (stateVal.val < startValue) {
					this.log.debug(`[calculationHandler] Wert zu klein`);
					myExit = true;
				} else {
					this.log.debug(
						`calculationHandler] +Setze+ ${stateDetails.deviceName}.${
							Object.values(stateNames)[myCalcMode]
						}`,
					);
					await this.setStateChangedAsync(
						`${stateDetails.deviceName}.${Object.values(stateNames)[myCalcMode]}`,
						{
							val: true,
							ack: true,
						},
					);
				}
			}
			let basiswert;
			// Define proper calculation value
			let reading;
			if (currentCath === "Watt" || currentCath === "W") {
				// Convert watt to watt hours
				reading = await this.wattToWattHour(stateID, stateVal);
				if (reading === null || reading === undefined) return;
			} else {
				reading = stateVal.val;
			}
			if (reading === null || reading === undefined) {
				this.log.error(
					`[calculationHandler] reading incorrect after conversion contact DEV and provide these info | Reading : ${JSON.stringify(
						reading,
					)} | start reading ${JSON.stringify(stateVal)} | stateDetails ${JSON.stringify(stateDetails)}`,
				);
				return;
			}
			const currentExponent = this.unitDef.unitConfig[stateDetails.stateUnit].exponent;
			// this.log.debug(`[calculationHandler] currentExponent : ${JSON.stringify(currentExponent)}`);
			const targetExponent = this.unitDef.unitConfig[stateDetails.useUnit].exponent;
			// this.log.debug(`[calculationHandler] targetExponent : ${JSON.stringify(targetExponent)}`);
			// this.log.debug(`[calculationHandler] reading value ${reading} before exponent multiplier`);
			// Logic to handle exponents and handle watt reading
			if (typeof reading === "number" || reading === 0) {
				if (calcValues.unit === "Watt" || calcValues.unit === "W") {
					// Add calculated watt reading to stored totals
					let cum = calcValues.cumulativeValue;
					if (cum === null || calcValues.cumulativeValue === undefined) {
						cum = 0;
					}
					reading = reading * Math.pow(10, currentExponent - targetExponent) + cum;
				} else {
					reading = reading * Math.pow(10, currentExponent - targetExponent);
				}
			} else {
				this.log.error(
					`Input value for ${stateID}, type = ${typeof reading} but should be a number, cannot handle calculation`,
				);
				return;
			}
			if (reading === null || reading === undefined) {
				this.log.error(
					`[calculationHandler] reading incorrect after Exponent conversion contact DEV and provide these info | Reading : ${JSON.stringify(
						reading,
					)} | start reading ${JSON.stringify(
						stateVal,
					)} | currentExponent ${currentExponent} | targetExponent ${targetExponent} | stateDetails ${stateDetails}`,
				);
				return;
			}
			// this.log.debug(
			// 	`[calculationHandler] reading value ${reading} after exponent multiplier : ${JSON.stringify(
			// 		targetExponent,
			// 	)}`,
			// );
			// Check if state was already initiated
			// Function to initiate proper memory values at device init and value reset
			const initiateState = async () => {
				// Prepare object array for extension
				const obj = {};
				obj.common = {};
				obj.common.custom = {};
				obj.common.custom[this.namespace] = {};
				// Update memory value with current & init value at object and memo
				this.log.debug(`[calculationHandler] Extend object with  ${JSON.stringify(obj)} `);
				// Ensure current value is set again after object extension as Workaround for Dev:0 bug
				// const objval = await this.getForeignStateAsync(stateID);
				await this.extendForeignObject(stateID, obj);
				this.log.debug(`[calculationHandler] State value before extension ${JSON.stringify(obj)} `);
				// // Set state value back on object (Prevent Dev: 0 bug)
				// if (objval) {
				// 	await this.setForeignStateAsync(stateID, {val: objval.val, ack: true});
				// }
			};
			//
			//
			//  frbr
			//
			// Update current value to memory
			this.log.debug(`[calculationHandler] State MyExit ${myExit} `);
			if (myExit) {
				// Add current reading to value in memory
				if (
					this.activeStates[stateID].calcValues.cumulativeValue == null ||
					this.activeStates[stateID].calcValues.cumulativeValue == "NaN"
				) {
					basiswert = 0;
				} else {
					basiswert = this.activeStates[stateID].calcValues.cumulativeValue;
				}
				reading = reading + basiswert;
				this.log.debug(`[calculationHandler] ${stateID} set cumulated value ${reading}`);
				this.log.error(`Reset aktiv ${stateDetails.deviceName}.${Object.values(stateNames)[myValue]}`);
				this.activeStates[stateID]["calcValues"].cumulativeValue = 0;
				if (typeof reading === "number") {
					await this.setStateChangedAsync(
						`${stateDetails.deviceName}.${Object.values(stateNames)[myValue]}`,
						{
							val: reading,
							ack: true,
						},
					);
				}
				await this.setStateChangedAsync(
					`${stateDetails.deviceName}.${Object.values(stateNames)[myTempValue]}`,
					{
						val: 0,
						ack: true,
					},
				);
				await this.setStateChangedAsync(`${stateDetails.deviceName}.${Object.values(stateNames)[myCalcMode]}`, {
					val: false,
					ack: true,
				});
				reading = 0;
			} else {
				this.log.error("Addieren mit Wert " + reading);
				this.activeStates[stateID]["calcValues"].cumulativeValue = reading;
				await this.setStateChangedAsync(
					`${stateDetails.deviceName}.${Object.values(stateNames)[myTempValue]}`,
					{
						val: reading,
						ack: true,
					},
				);
			}
		} catch (error) {
			this.errorHandling(
				`[calculationHandler] ${stateID} with config ${JSON.stringify(this.activeStates[stateID])}`,
				error,
			);
		}
	}

	/**
	 * @param {string} [stateID]- ID of state
	 * @param {object} [value] - Current value in wH
	 */
	async wattToWattHour(stateID, value) {
		try {
			const calcValues = this.activeStates[stateID].calcValues;
			// this.log.debug(
			// 	`[wattToWattHour] Watt to kWh, current reading : ${value.val} previousReading : ${JSON.stringify(
			// 		calcValues,
			// 	)}`,
			// );
			// Prepare needed data to handle calculations
			const readingData = {
				previousReadingWatt: Number(calcValues.previousReadingWatt),
				previousReadingWattTs: Number(calcValues.previousReadingWattTs),
				currentReadingWatt: Number(value.val),
				currentReadingWattTs: Number(value.ts),
			};
			// Prepare function return
			let calckWh;
			if (readingData.previousReadingWatt && readingData.previousReadingWattTs) {
				// Calculation logic W to kWh
				calckWh =
					((readingData.currentReadingWattTs - readingData.previousReadingWattTs) *
						readingData.previousReadingWatt) /
					3600000;
				// this.log.debug(`[wattToWattHour] ${stateID} result of watt to kWh calculation : ${calckWh}`);
				// Update timestamp current reading to memory
				this.activeStates[stateID]["calcValues"].previousReadingWatt = readingData.currentReadingWatt;
				this.activeStates[stateID]["calcValues"].previousReadingWattTs = readingData.currentReadingWattTs;
			} else {
				// this.log.debug(`[wattToWattHour] No previous reading available, store current to memory`);
				// Update timestamp current reading to memory
				this.activeStates[stateID]["calcValues"].previousReadingWatt = readingData.currentReadingWatt;
				this.activeStates[stateID]["calcValues"].previousReadingWattTs = readingData.currentReadingWattTs;
				calckWh = 0; // return 0 kWh consumption as measurement
			}
			// this.log.debug(
			// 	`[wattToWattHour] ${stateID} Watt to kWh outcome : ${JSON.stringify(
			// 		this.activeStates[stateID].calcValues,
			// 	)}`,
			// );
			return calckWh;
		} catch (error) {
			this.errorHandling(`[wattToWattHour] ${stateID}`, error);
		}
	}

	//Function to handle messages from State settings and provide Unit and Price definitions
	async onMessage(obj) {
		if (obj) {
			switch (obj.command) {
				case "getUnits":
					if (obj.callback) {
						const unitArray = [];
						unitArray.push({ label: "Detect automatically", value: "Detect automatically" });
						for (const priceDefinition in this.unitDef.unitConfig) {
							unitArray.push({ label: priceDefinition, value: priceDefinition });
						}
						this.sendTo(obj.from, obj.command, unitArray, obj.callback);
					}
					break;
			}
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new DeltaConsumption(options);
} else {
	// otherwise start the instance directly
	new DeltaConsumption();
}
