"use strict";

let mongoDB = undefined;
const Rx = require("rxjs");
const CollectionName = "Settlements";

class SettlementDA {

  static start$(mongoDbInstance) {
    return Rx.Observable.create(observer => {
      if (mongoDbInstance) {
        mongoDB = mongoDbInstance;
        observer.next("using given mongo instance ");
      } else {
        mongoDB = require("./MongoDB").singleton();
        observer.next("using singleton system-wide mongo instance");
      }
      observer.complete();
    });
  }


  /**
   * takes an array of settlements  and creates a single insert statement
   * @param {Array} settlements 
   * @returns {Rx.Observable} insert statement
   */
  static generateSettlementInsertStatement$(settlements) {
    return Rx.Observable.of(settlements)
      .map(setts => {
        return {
          collection: CollectionName,
          operation: "insertMany",
          operationArgs: [setts]
        };
      });
  }

  /**
   * Gets the Settlement by id
   * @param {*} settlementId ID
   * @returns {Rx.Observable}
   */
  static getSettlement$(settlementId) {
    const collection = mongoDB.db.collection(CollectionName);
    return Rx.Observable.defer(() =>
      collection.findOne({ _id: settlementId })
    );
  }


}

/**
 * Returns a SettlementDA
 * @returns {SettlementDA}
 */
module.exports = SettlementDA;