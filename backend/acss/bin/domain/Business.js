"use strict";

const Rx = require("rxjs");
const BusinessDA = require("../data/BusinessDA");
const BusinessValidatorHelper = require("./BusinessValidatorHelper");
const broker = require("../tools/broker/BrokerFactory")();
const eventSourcing = require("../tools/EventSourcing")();
const RoleValidator = require("../tools/RoleValidator");
const Event = require("@nebulae/event-store").Event;
const uuidv4 = require("uuid/v4");
const MATERIALIZED_VIEW_TOPIC = "materialized-view-updates";
const {
  CustomError,
  DefaultError,
} = require("../tools/customError");
const {
  PERMISSION_DENIED_ERROR_CODE,
  INTERNAL_SERVER_ERROR_CODE
} = require("../tools/ErrorCodes");

/**
 * Singleton instance
 */
let instance;

class Business {
  constructor() {}

  /**
   * Gets the business where the user that is performing the request belong
   *
   * @param {*} args args 
   */
  getACSSBusiness$({ args }, authToken) {
    console.log('getACSSBusiness =>', authToken);
    return BusinessValidatorHelper.validateData$(authToken)
      .mergeMap(val => BusinessDA.getBusiness$(authToken.businessId))
      .do(val => {
        console.log('Prueba => ', val);
      })
      .mergeMap(rawResponse => this.buildSuccessResponse$(rawResponse))
      .catch(err => {
        return this.handleError$(err);
      });
  }

  /**
   * Gets the businesses registered on the platform
   *
   * @param {*} args args that contain the business filters
   */
  getACSSBusinesses$({ args }, authToken) {
    return RoleValidator.checkPermissions$(
      authToken.realm_access.roles,
      "acss",
      "getACSSBusinesses$()",
      PERMISSION_DENIED_ERROR_CODE,
      "Permission denied",
      ["system-admin", "business-owner"]
    )
      .mergeMap(val => BusinessDA.getAllBusinesses$())
      .toArray()
      .mergeMap(rawResponse => this.buildSuccessResponse$(rawResponse))
      .catch(err => {
        return this.handleError$(err);
      });
  }

  //#region  mappers for API responses

  handleError$(err) {
    return Rx.Observable.of(err).map(err => {
      const exception = { data: null, result: {}};
      const isCustomError = err instanceof CustomError;
      if (!isCustomError) {
        err = new DefaultError(err);
      }
      exception.result = {
        code: err.code,
        error: { ...err.getContent() }
      };
      return exception;
    });
  }

  buildSuccessResponse$(rawRespponse) {
    return Rx.Observable.of(rawRespponse).map(resp => {
      return {
        data: resp,
        result: {
          code: 200
        }
      };
    });
  }

  //#endregion
}

/**
 * @returns {Business}
 */
module.exports = () => {
  if (!instance) {
    instance = new Business();
    console.log(`${instance.constructor.name} Singleton created`);
  }
  return instance;
};