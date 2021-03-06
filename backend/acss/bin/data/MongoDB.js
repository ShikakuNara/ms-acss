"use strict";

const Rx = require("rxjs");
const MongoClient = require("mongodb").MongoClient;
let instance = null;

class MongoDB {
  /**
   * initialize and configure Mongo DB
   * @param { { url, dbName } } ops
   */
  constructor({ url, dbName }) {
    this.url = url;
    this.dbName = dbName;
  }

  /**
   * Starts DB connections
   * @returns {Rx.Observable} Obserable that resolve to the DB client
   */
  start$() {
    return Rx.Observable.bindNodeCallback(MongoClient.connect)(this.url).map(
      client => {
        console.log(this.url);
        this.client = client;
        this.db = this.client.db(this.dbName);
        return `MongoDB connected to dbName= ${this.dbName}`;
      }
    );
  }

  /**
   * Stops DB connections
   * Returns an Obserable that resolve to a string log
   */
  stop$() {
    return Rx.Observable.create(observer => {
      this.client.close();
      observer.next("Mongo DB Client closed");
      observer.complete();
    });
  }


  /**
   * Ensure Index creation
   * Returns an Obserable that resolve to a string log
   */
  createIndexes$() {
    return Rx.Observable.create(async observer => {
      //observer.next('Creating index for DB_NAME.COLLECTION_NAME => ({ xxxx: 1 })  ');
      await this.db.collection('Clearing').createIndex( { businessId: 1});

      // await this.db.collection('Clearing').createIndex( { businessId: 1});

      observer.next("All indexes created");
      observer.complete();
    });
  }


  /**
   * Ensure collection creation
   */
  createCollections$() {
    return Rx.Observable.concat(
      this.createCollection$('AccumulatedTransactions'),
      this.createCollection$('Transactions'),
      this.createCollection$('TransactionsCursor'),
      this.createCollection$('Clearing'),
      this.createCollection$('ClosedClearing'),
      this.createCollection$('Business'),
      this.createCollection$('Settlements'),
    );
  }

  /**
   * Ensure collection creation
   */
  createCollection$(collectionName) {
    return Rx.Observable.create(async observer => {
      await this.db.createCollection(collectionName);
      observer.next(`collection ${this.dbName}.${collectionName} created`);
      observer.complete();
    });
  }

  /**
   * Returns an observable that takes an array of operations (insert, updateOne, ...)
   * an executes each one on Mongo in a transactional environment.
   * If an error ocurs the transaction will be aborted and all of the operations will be ignored.
   *
   * Note: Mongo transactions only work with Mongo Replicaset and operations 
   * such as creating or dropping a collections or an index are not allowed.
   *
   * @param collectionVsOperationAndCommand array of collections vs operations
   * @param collectionVsOperationAndCommand.collection Collection name where the operation will be applied
   * @param collectionVsOperationAndCommand.operation indicates which operation will be executed (E.g insert, updateOne, ...)
   * @param collectionVsOperationAndCommand.operationArgs Array that indicates the values that will be passed as arguments of the operation to execute.
   * @param {collectionVsOperationAndCommand.operationOps} [collectionVsOperationAndCommand.operationOps] - indicates the options that will be passed as arguments of the operation to execute.
   * 
   * @example
   * const collectionVsOperationAndCommand = [
        {
            collection: "collectionName1",
            operation: "insertOne",
            operationArgs: [{ name: "John", lastname: 'Doe', state: true }]
        },
        {
            collection: "collectionName2",
            operation: "updateOne",
            operationArgs: [{ name: "John"}, { $set: {name: 'John Doe'} }],
            operationOps: {},
        }
      ];
   * @returns {Observable} An observable that executes the Mongo operations
   */
  applyAll$(collectionVsOperationAndCommand) {
    //Starts Mongo session
    return (
      Rx.Observable.defer(() => Rx.Observable.of(this.client.startSession()))
        //Starts Mongo transaction
        .mergeMap(session => {
          session.startTransaction();
          return Rx.Observable.of(session);
        })
        .mergeMap(session => {
          return (
            Rx.Observable.of(session)
              .mergeMap(tx => {
                //Executes each operation on Mongo
                return (
                  Rx.Observable.from(collectionVsOperationAndCommand)
                    .concatMap(data => {                      
                      //To execute all of the operations into a transactionsal environment, we must pass the session to each operation
                      data.operationOps =
                        data.operationOps == null
                          ? { session }
                          : { ...data.operationOps, session };

                      return this.db
                        .collection(data.collection)
                      [data.operation](
                        ...data.operationArgs,
                        data.operationOps
                      );
                    })
                    .toArray()
                );
              })
              //Commits Mongo transaction
              .mergeMap(
                txs => Rx.Observable.defer(() => session.commitTransaction())
                  .mergeMap(txResult =>
                      //Ends Mongo session
                     Rx.Observable.bindCallback(session.endSession.bind(session))().mapTo([txs, txResult])                   
                  )
              )
              //If an error ocurred, the transaction is aborted
              .catch(err => {
                return Rx.Observable.of(err)
                  .mergeMap(error => session.abortTransaction())
                  .mergeMap(txResult =>
                    Rx.Observable.bindCallback(session.endSession.bind(session))()
                  )
                  .mergeMap(error => Rx.Observable.throw(err)); // Rethrow so calling function sees error);
              })
          );
        })
    );
  }


  /**
   * Moves a document from one collection to another collection (Atomic)
   * @param string fromCollectionName current document collection
   * @param string toCollectionName desired document collections
   * @param string documentId ID of the document to move
   * @returns {Rx.Observable}
   */
  moveDocumentToOtherCollectionsStatements$(fromCollectionName, toCollectionName, documentId) {
    return this.generateMoveDocumentToOtherCollectionsStatements$(fromCollectionName, toCollectionName, documentId)
      .toArray()
      .mergeMap(statements => this.applyAll$(statements));
  }


  /**
   * generates the statements to moves a document from one collection to another collection
   * @param string fromCollectionName current document collection
   * @param string toCollectionName desired document collections
   * @param string documentId ID of the document to move
   * @returns {Rx.Observable}
   */
  generateMoveDocumentToOtherCollectionsStatements$(fromCollectionName, toCollectionName, documentId) {
    const fromCollection = this.db.collection(fromCollectionName);

    return Rx.Observable.defer(() => fromCollection.findOne({ _id: documentId }))
      .mergeMap(document =>
        Rx.Observable.merge(
          Rx.Observable.of(
            {
              collection: toCollectionName,
              operation: "insertOne",
              operationArgs: [document]
            }
          ),
          Rx.Observable.of(
            {
              collection: fromCollectionName,
              operation: "deleteOne",
              operationArgs: [{ _id: documentId }]
            }
          ),
        )
      );
  }

  /**
   * Drop current DB
   */
  dropDB$() {
    return Rx.Observable.create(async observer => {
      await this.db.dropDatabase();
      observer.next(`Database ${this.dbName} dropped`);
      observer.complete();
    });
  }

  /**
   * extracts every item in the mongo cursor, one by one
   * @param {*} cursor 
   */
  static extractAllFromMongoCursor$(cursor) {
    return Rx.Observable.create(async observer => {
      let obj = await MongoDB.extractNextFromMongoCursor(cursor);
      while (obj) {
        observer.next(obj);
        obj = await MongoDB.extractNextFromMongoCursor(cursor);
      }
      observer.complete();
    });
  }

  /**
   * Extracts the next value from a mongo cursos if available, returns undefined otherwise
   * @param {*} cursor 
   */
  static async extractNextFromMongoCursor(cursor) {
    const hasNext = await cursor.hasNext();
    if (hasNext) {
      const obj = await cursor.next();
      return obj;
    }
    return undefined;
  }

}




module.exports = {
  /**
   * Mongo class
   * @return {MongoDB}
   */
  MongoDB,
  /**
   * Gets the singleton instance of Mongo
   * @return {MongoDB} The mongoDB instance
   */
  singleton() {
    if (!instance) {
      instance = new MongoDB({
        url: process.env.MONGODB_URL,
        dbName: process.env.MONGODB_DB_NAME
      });
      console.log(`MongoDB instance created: ${process.env.MONGODB_DB_NAME}`);
    }
    return instance;
  }
};
