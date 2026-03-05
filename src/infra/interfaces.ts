/* eslint-disable @typescript-eslint/ban-types */
import {PropType} from "./propTypes";

// From https://stackoverflow.com/a/50375286
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;
// From: https://stackoverflow.com/a/53955431
type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;
type SingleKey<T> = IsUnion<keyof T> extends true ? never : {} extends T ? never : T;
type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
export type Maybe<T> = T | null;
export type Array<T> = T[];

export const ForceAs = <T>(value: unknown = null): T => value as T;

export type Class<T> = abstract new (...args: unknown[]) => T

export type ClassWithType<T> = Class<T> & {
    type: string
}

export type ClassWithMeta<T, TSanitized = Omit<T, '__typename'>> = Class<T> & {
    type: string
    propTypes: {[k in keyof TSanitized]: PropType<TSanitized[k]>}
    fromObject: (args: T) => T
}

export interface ApiRequest<TUser, TArgs> {
    user: TUser
    args: TArgs
}

export type ApiFindByFilterRequest<TUser, TRecord> = ApiRequest<TUser, { filter: Filter<TRecord> }>
export type ApiFindOneRequest<TUser, TRecord> = ApiRequest<TUser, { where: Where<TRecord> }>

type ErrorData = {
    message: string
}

type IApiResponse<TData = unknown> = {
    statusCode: number
    data: TData | ErrorData | undefined
} | TData

type ApiErrorResponse<TData extends ErrorData> = {
    statusCode: number
    data: TData
}

export interface IApi<TUser = unknown> {
    findOne<TModel extends ReadModel, TRecord = TModel['record']>(
      name: string,
      readModel: TModel,
      handler: (r: ApiRequest<TUser, {where: Where<TRecord>}>) => Promise<IApiResponse<TRecord>>
    ): void
    findOne<TModel extends ReadModel, TRecord = TModel['record'], TInput = unknown>(
      name: string,
      readModel: TModel,
      TInput: ClassWithMeta<TInput>,
      handler: (r: ApiRequest<TUser, TInput>) => Promise<IApiResponse<TRecord>>
    ): void
    findByFilter<TModel extends ReadModel, TRecord = TModel['record']>(
      name: string,
      readModel: TModel,
      handler: (r: ApiRequest<TUser, {filter: Filter<TRecord>}>) => Promise<IApiResponse<Array<TRecord> | PaginatedResult<TRecord>>>
    ): void
    findByFilter<TModel extends ReadModel, TInput, TRecord = TModel['record']>(
      name: string,
      readModel: TModel,
      TInput: ClassWithMeta<TInput>,
      handler: (r: ApiRequest<TUser, TInput>) => Promise<IApiResponse<Array<TRecord> | PaginatedResult<TRecord>>>
    ): void
    command<T>(
      name: string,
      TCommand: ClassWithMeta<T>,
      handler: (r: ApiRequest<TUser, T>) => Promise<IApiResponse<T>>
    ): void
    command<TIn, TOut>(
      name: string,
      TCommand: ClassWithMeta<TOut>,
      TInput: ClassWithMeta<TIn>,
      handler: (r: ApiRequest<TUser, TIn>) => Promise<IApiResponse<TOut>>
    ): void
    ok<TData>(data?: TData): IApiResponse<TData>
    created<TData>(data?: TData): IApiResponse<TData>
    found(url: string): IApiResponse
    badRequest<TData extends ErrorData>(data?: TData): ApiErrorResponse<TData>
    unauthorized<TData extends ErrorData>(data: TData): ApiErrorResponse<TData>
    forbidden<TData extends ErrorData>(data?: TData): ApiErrorResponse<TData>
    notFound<TData extends ErrorData>(data?: TData): ApiErrorResponse<TData>
    conflict<TData extends ErrorData>(data?: TData): ApiErrorResponse<TData>
    error<TData extends ErrorData>(data?: TData): ApiErrorResponse<TData>
}

export interface createApi {
    <TUser = unknown>(name: string): IApi<TUser>
}

type Constraints<T> = {
    $eq: T
} | {
    $neq: T
} | {
    $inq: Array<T>
} | {
    $between: [T, T]
} | {
    $gte: T
} | {
    $gt: T
} | {
    $lte: T
} | {
    $lt: T
} | {
    $ilike: string
}

export type Where<T> = Partial<T> | Partial<{
    [P in keyof T]: Constraints<T[P]>
}> | {
    $and: Array<Where<T>>
} | {
    $or: Array<Where<T>>
}

export type Filter<T> = {
    where: Where<T>
    limit: number
    skip?: number
    order: string | string[]
    fields?: Array<keyof T>
}

export type PaginatedResult<T> = {
    readonly items: Array<T>
    readonly total: number
}

export type CursorFilter<T> = {
    where: Where<T>
    orderBy: [keyof T, 'ASC' | 'DESC']
    limit: number
    nextToken: string | null | undefined
    fields?: Array<keyof T>
}

export type CursorResult<T> = {
    readonly items: Array<T>
    readonly total: number
    readonly nextToken: string | null
}

type CommandHandlerOptions = {
    oneOff?: boolean
}

type CommandHandlerResult<T = unknown, TMeta = unknown> = {
    readonly command: T
    readonly streamId: string
    readonly committedEvents: Array<unknown>
    readonly metadata: TMeta
    readonly nextExpectedVersion?: number
    readonly logPosition?: IPosition
}

export interface commandHandler {
    <TAggregate, TCommand = unknown, TMetadata extends DefaultMetadata = DefaultMetadata>(Aggregate: ClassWithType<TAggregate>, aggregateId: string, cmd: TCommand, metadata?: TMetadata, options?: CommandHandlerOptions): Promise<CommandHandlerResult>
}

export interface ILogger {
    debug(...args: unknown[]): void
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
}

export type DefaultMetadata = {
    $correlationId?: string
    timestamp?: number
    userId?: string
}

export interface IPosition {
    toString(): string
    compareTo(other: IPosition): number
}

export type BuilderEventData<TEvent = unknown, TMetadata extends DefaultMetadata = DefaultMetadata> = {
    readonly streamId: string
    readonly eventId: string
    readonly eventNumber: number
    readonly typeId: string
    readonly event: TEvent
    readonly metadata: TMetadata | null
    readonly creationTime: number
    readonly position: IPosition | null
}

export interface ITransactionalRepository<T> {
    //write
    create_v2(payload: T): void
    upsert(payload: T): void
    updateOne(where: Where<T>, changes: Partial<T>): void
    updateWhere(where: Where<T>, changes: Partial<T>): void
    remove(where: Where<T>): void
    //read
    exists(where: Where<T>): Promise<boolean>
    getOne(where: Where<T>): Promise<T>
    findOne_v2(where: Where<T>): Promise<Maybe<T>>
    findWhere(where: Where<T>): Promise<Array<T>>
    findByFilter_v2(filter: Filter<T>): Promise<Array<T>>
    findPaginated(filter: Filter<T>): Promise<PaginatedResult<T>>
    findAll(): Promise<Array<T>>
}

type SchemaItems = {
    type: string
    nullable?: boolean
}

type SchemaDesc = {
    type: string
    format?: string
    items?: SchemaItems
    nullable?: boolean
}

export type ReadModelConfig = {
    key: string | Array<string>
    indexes?: Array<string | Array<string>>
    schema: {
        [prop: string]: SchemaDesc
    }
}

type LookupConfig<T = unknown> = ReadModelConfig & {
    record: T
}

export type LookupsDesc = {
    [name: string]: LookupConfig
}

export type Lookups<L extends LookupsDesc = LookupsDesc> = {
    [N in keyof L]: ITransactionalRepository<L[N]['record']>
}

export type ReadModel<T = unknown, TLookups extends LookupsDesc = LookupsDesc> = {
    config: ReadModelConfig
    record: T
    lookups: TLookups,
    handler: (repo: ITransactionalRepository<T>, eventData: BuilderEventData, lookups?: Lookups<TLookups>) => Promise<ITransactionalRepository<T> | void>
}

export type ReadModelsMap = {
    [name: string]: ReadModel
}

export type FieldsOption<TKey> = {
    fields?: Array<TKey>
}

export type ConsistentOptions = {
    minPos?: IPosition
    consistent?: boolean
}

export interface IReadRepository<TReadModels extends ReadModelsMap, TGlobalOptions extends Record<string, unknown> = {}> {
    exists<
      TKey extends keyof TReadModels,
      TRecord extends TReadModels[TKey]['record'] = TReadModels[TKey]['record'],
      TOptions extends TGlobalOptions = TGlobalOptions
      >(rm: TKey, where: Where<TRecord>, options?: TOptions): Promise<boolean>
    getOne<
      TKey extends keyof TReadModels,
      TRecord extends TReadModels[TKey]['record'] = TReadModels[TKey]['record'],
      TOptions extends TGlobalOptions & FieldsOption<keyof TRecord> = TGlobalOptions & FieldsOption<keyof TRecord>
      >(rm: TKey, where: Where<TRecord>, options?: TOptions): Promise<TRecord>
    findOne_v2<
      TKey extends keyof TReadModels,
      TRecord extends TReadModels[TKey]['record'] = TReadModels[TKey]['record'],
      TOptions extends TGlobalOptions & FieldsOption<keyof TRecord> = TGlobalOptions & FieldsOption<keyof TRecord>
      >(rm: TKey, where: Where<TRecord>, options?: TOptions): Promise<Maybe<TRecord>>
    findWhere<
      TKey extends keyof TReadModels,
      TRecord extends TReadModels[TKey]['record'] = TReadModels[TKey]['record'],
      TOptions extends TGlobalOptions & FieldsOption<keyof TRecord> = TGlobalOptions & FieldsOption<keyof TRecord>
      >(rm: TKey, where: Where<TRecord>, options?: TOptions): Promise<Array<TRecord>>
    findByFilter_v2<
      TKey extends keyof TReadModels,
      TRecord extends TReadModels[TKey]['record'] = TReadModels[TKey]['record']
      >(rm: TKey, filter: Filter<TRecord>, options?: TGlobalOptions): Promise<Array<TRecord>>
    findPaginated<
      TKey extends keyof TReadModels,
      TRecord extends TReadModels[TKey]['record'] = TReadModels[TKey]['record']
      >(rm: TKey, filter: Filter<TRecord>, options?: TGlobalOptions): Promise<PaginatedResult<TRecord>>
    findCursor<
      TKey extends keyof TReadModels,
      TRecord extends TReadModels[TKey]['record'] = TReadModels[TKey]['record']
      >(rm: TKey, filter: CursorFilter<TRecord>, options?: TGlobalOptions): Promise<CursorResult<TRecord>>
    findAll<
      TKey extends keyof TReadModels,
      TRecord extends TReadModels[TKey]['record'] = TReadModels[TKey]['record'],
      TOptions extends TGlobalOptions & FieldsOption<keyof TRecord> = TGlobalOptions & FieldsOption<keyof TRecord>
      >(rm: TKey, options?: TOptions): Promise<Array<TRecord>>
}

export type MapperReadResult<T> = {
    readonly results: Array<T>
    readonly total?: number
    readonly nextToken?: string
}

export type setInterval<TArgs extends unknown[] = unknown[]> = (cb: (...args: TArgs) => void, ms: number, ...args: TArgs) => number

export type ESEventData = {
    eventId: string
    eventType: string
    data: unknown
    metadata: unknown
}

export type EventStoredData<TData = unknown, TMedataData = unknown> = {
    readonly position: IPosition | null
    readonly eventId: string
    readonly streamId: string
    readonly eventNumber: number
    readonly eventType: string
    readonly data: TData
    readonly metadata: TMedataData
    readonly createdEpoch: number
}

export interface ISubscription {
    stop(): void
}

export interface IEventStore {
    readonly EXPECT_ANY: number
    appendToStream(streamId: string, eventDatas: Array<ESEventData>, expectedVersion: number): Promise<IPosition>
    read(streamId: string, start?: number, options?: unknown): Promise<Array<EventStoredData>>
    subscribeToAll(onEventAppeared: (eventData: EventStoredData) => void | Promise<void>, onSubscriptionDropped: () => void): ISubscription
}

export interface IService {
    start(): Promise<void>
    stop(): Promise<void>
}

export interface IMetrics {
    time<T>(key: string, fn: () => Promise<T>): Promise<T>
    capture(key: string, value: number): void
    compute(key?: string): Record<string, Record<string, number>>
}

export interface IEventualConsistencyService extends IService {
    waitFor(readModelName: string, minPosition: IPosition, timeoutInMillis?: number): Promise<void>
}

export interface IGraphQLAdapter<T, TRootResolvers = RequireFields<T, keyof T>> {
    addFieldResolver<RootK extends keyof TRootResolvers, TypeResolver extends TRootResolvers[RootK], FieldK extends keyof TypeResolver>(
      typeName: RootK,
      fieldName: FieldK,
      handler: TypeResolver[FieldK]
    ): void
}
type CryptoContext = {
    iv: Buffer
}
export type EncryptFn = <T>(ctx: CryptoContext, obj: T, fieldsToEncrypt?: (keyof T)[]) => T
export type DecryptFn = <T>(ctx: CryptoContext, obj: T, fieldsToDecrypt?: (keyof T)[]) => T
