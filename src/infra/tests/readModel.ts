/**
 * Read Model Test Infrastructure
 * Copied from cqrs-typescript with adaptations for sociable-platform
 */

import { v4 as uuidV4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import TransactionalRepository from '../TransactionalRepository.js';
import { buildModelDefs } from '../readModels.js';
import Mapper from '../websqldb/Mapper.js';
import websql from 'websql';
import DBPool from '../websqldb/DBPool.js';
import ReadRepository from '../ReadRepository.js';
import Batcher from '../Batcher.js';
import ConsoleLogger from '../ConsoleLogger.js';

// Type definitions
interface BuilderEventData {
  streamId: string;
  eventNumber: number;
  position: unknown;
  event: unknown;
  eventId: string;
  typeId: string;
  creationTime: number;
  metadata: Record<string, unknown>;
}

interface ReadModel {
  name: string;
  config: unknown;
  lookups?: Record<string, unknown>;
  handler: (repo: TransactionalRepository, eventData: BuilderEventData, lookups?: Record<string, TransactionalRepository>) => Promise<void>;
}

type TestContextInternal<TRecord = unknown> = {
  readRepository: ReadRepository;
  mapper: unknown;
  store?: unknown;
  dbPool?: DBPool;
  logger: unknown;
  batcher?: unknown;
};

type TestContext<TModel = unknown> = {
  given: <TEvent, TMetadata>(event: TEvent, metadata?: TMetadata, overrides?: Partial<BuilderEventData>) => void;
  then: (testName: string, testFn: (records: TModel[]) => void) => void;
  expect: typeof expect;
};

type ModelWithName = ReadModel & {
  name: string;
};

function getTypeName(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  const constructor = (obj as Record<string, unknown>).constructor as { type?: string; name?: string };
  return constructor?.type || constructor?.name || '';
}

/**
 * Read model tests factory
 *
 * @param readModels Object with the readModel to test, i.e. {users} where users is the read model definition
 */
export default function rmTests<TModel extends ReadModel, TRecord = unknown>(
  readModels: { [name: string]: TModel }
) {
  return function rmTest(
    blockName: string,
    blockFn: (props: TestContext<TRecord>) => void
  ) {
    const readModelList = Object.keys(readModels).map((name) => {
      return { name, ...readModels[name] };
    });
    const readModelUnderTest = readModelList[0];
    if (readModelList.length > 1) {
      throw new Error('Testing more than one read model is not possible.');
    }
    let ctx: TestContextInternal<TRecord>;

    async function setUp() {
      if (ctx) return;
      const logger = new ConsoleLogger(process.env.DEBUG ? 'debug' : 'off');
      const modelDefs = buildModelDefs(readModelList);
      const mapper = new Mapper(modelDefs, logger);
      const db = websql(':memory:', '1.0', '', 0);
      const dbPool = new DBPool(db);
      for (const readModel of readModelList) {
        await mapper.tryDropModel(dbPool, readModel.name);
        await mapper.tryCreateModel(dbPool, readModel.name);
        if (readModel.lookups) {
          for (const k in readModel.lookups) {
            await mapper.tryDropModel(dbPool, `${readModel.name}_${k}_lookup`);
            await mapper.tryCreateModel(dbPool, `${readModel.name}_${k}_lookup`);
          }
        }
      }
      const readRepository = new ReadRepository(mapper, dbPool, logger);
      ctx = { readRepository, mapper, store: dbPool, dbPool, logger };
    }

    function tearDown() {
      return ctx.dbPool?.end();
    }

    async function processEvent<TEvent = unknown, TMetadata = unknown>(
      event: TEvent,
      metadata: TMetadata,
      overrides: Partial<BuilderEventData>
    ) {
      const ts = Date.now();
      const eventData: BuilderEventData = {
        streamId: '',
        eventNumber: 0,
        position: null,
        event,
        eventId: uuidV4(),
        typeId: getTypeName(event),
        creationTime: ts,
        metadata: { timestamp: ts, ...metadata },
        ...overrides,
      };
      const conn = await ctx.dbPool?.getConnection();
      const batcher = new Batcher(conn);
      await batcher.begin();
      const readRepository = new ReadRepository(ctx.mapper, ctx.dbPool, ctx.logger);
      try {
        for (const readModel of readModelList) {
          const modelRepository = new TransactionalRepository(
            ctx.mapper,
            readModel.name,
            readRepository,
            batcher,
            ctx.logger
          );
          const lookups = buildLookups(readModel, {
            mapper: ctx.mapper,
            readRepository,
            batcher,
            logger: ctx.logger,
          });
          await readModel.handler(modelRepository, eventData, lookups);
        }
        await batcher.end();
      } finally {
        await batcher.dispose();
        await ctx.dbPool?.release(conn);
      }
    }

    function given<TEvent, TMetadata>(
      event: TEvent,
      metadata?: TMetadata,
      overrides?: Partial<BuilderEventData>
    ) {
      beforeAll(async () => {
        await processEvent(event, metadata, overrides ?? {});
      });
    }

    function then(testName: string, testFn: (records: TRecord[]) => void) {
      it(testName, async () => {
        const records = await ctx.readRepository.findAll(readModelUnderTest.name);
        await testFn(records as TRecord[]);
      });
    }

    const testCtx: TestContext<TRecord> = { given, then, expect };
    describe(blockName, () => {
      beforeAll(setUp);
      afterAll(tearDown);
      blockFn(testCtx);
    });
  };
}

function buildLookups(
  { name, lookups }: ModelWithName,
  { mapper, readRepository, batcher, logger }: TestContextInternal
) {
  const results: { [k: string]: TransactionalRepository } = {};
  if (lookups) {
    for (const k in lookups) {
      const lookupName = `${name}_${k}_lookup`;
      results[k] = new TransactionalRepository(mapper, lookupName, readRepository, batcher, logger);
    }
  }
  return results;
}
