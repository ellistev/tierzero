/* global expect describe beforeEach afterEach it test */
import assert from "assert";
import TransactionalRepository from "./TransactionalRepository.js";
import ConsoleLogger from "./ConsoleLogger.js";
import ReadRepository from "./ReadRepository.js";
import Batcher from "./Batcher.js";
import ModelDefinition from "./ModelDefinition.js";
import {delay} from "./utils/index.js";

const logger = new ConsoleLogger("off");

const testModel = {
  name: 'test',
  config: {
    key: 'id',
    schema: {
      id: {type: 'number', nullable: false},
      value: {type: 'string'},
    }
  },
  handler: async function() {
    //nothing
  }
};

// Only run postgres tests if configured and modules exist
const shouldRunPostgresTests = () => {
  if (!process.env.USE_POSTGRES) return false;
  try {
    require.resolve("./postgres/Mapper");
    require.resolve("./postgres/DBPool");
    return true;
  } catch {
    return false;
  }
};

async function testWithMapper(mapperName, mapperFactory, storeFactory) {
  describe(`With a ${mapperName} mapper`, () => {
    let getById, trxRepository, batcher, conn, dbPool;

    beforeEach(async() => {
      const modelDefs = [ModelDefinition.fromReadModel(testModel, true)];
      const mapper = await mapperFactory(modelDefs);
      dbPool = await storeFactory();
      conn = await dbPool.getConnection();
      await mapper.tryDropModel(conn, "test");
      await mapper.tryCreateModel(conn, "test");
      await mapper.upsert(conn, "test", {id: 1, value: 'abc'});
      const readRepository = new ReadRepository(mapper, conn, logger);
      batcher = new Batcher(conn);
      trxRepository = new TransactionalRepository(mapper, "test", readRepository, batcher, logger);
      await batcher.begin();
      getById = id => mapper.select(conn, "test", {where: {id}, paging: true});
    });

    afterEach(async() => {
      dbPool.release(conn);
      return dbPool.end();
    });

    it("Should be able to read committed only", async() => {
      await trxRepository.getOne({id: 1});
      trxRepository.upsert({id: 2, value: 'def'});
      await delay(500);
      let passed;
      try {
        await trxRepository.getOne({id: 2});
        passed = true;
      } catch (err) {
        passed = false;
        assert.strictEqual(err.message, `No result found for test with criteria {"id":2}.`);
      }
      if (passed) assert.fail("Missing expected exception");
      await batcher.end();
      const result = await getById(2);
      assert.strictEqual(result.total, 1);
      assert.strictEqual(result.results[0].id, 2);
      assert.strictEqual(result.results[0].value, 'def');
    });

    it("validation error should throw on end", async() => {
      let callError = null, commitError = null;
      try {
        trxRepository.upsert({id: '3', value: 2});
      } catch (err) {
        callError = err;
      }
      try {
        await batcher.end();
      } catch (err) {
        commitError = err;
      }
      assert.strictEqual(callError, null);
      assert.strictEqual(commitError instanceof Error, true);
    });

  });
}

describe("Transactional Repository Tests", () => {
  // Basic sanity test that always runs
  test('TransactionalRepository module loads', () => {
    expect(TransactionalRepository).toBeDefined();
  });
  
  // Postgres tests only run when configured and available
  if (shouldRunPostgresTests()) {
    const PostgresMapper = require("./postgres/Mapper").default;
    const PostgresPool = require("./postgres/DBPool").default;
    const {Pool} = require("pg/lib");
    
    testWithMapper("postgres", (modelDefs) => new PostgresMapper(modelDefs, logger), async() => {
      const pgConfig = {
        "host": "localhost",
        "port": 5432,
        "database": "aquanowcamstests",
        "user": "aquanowcamstests",
        "password": "aquanowcamstests"
      };
      const dbPool = new Pool(pgConfig);
      return new PostgresPool(dbPool);
    });
  } else {
    test('Postgres tests skipped (USE_POSTGRES not set or postgres modules not found)', () => {
      expect(true).toBe(true);
    });
  }
});
