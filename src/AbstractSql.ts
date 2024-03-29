/* eslint-disable */
// There are too many funky type tricks going on in this file to meaningfuly enable eslint here
import { v6 as uuid } from "@kael-shipman/uuid-with-v6";
import type {
  SimpleSqlDbInterface,
  SqlValue,
  SqlPrimitive,
  SimpleLoggerInterface,
} from "@wymp/ts-simple-interfaces";
import * as E from "@wymp/http-errors";
import type { Api, Auth, Audit, PartialSelect } from "@wymp/types";

/** A re-export of the uuid/v6 function from @kael-shipman/uuid-with-v6 */
export { uuid };

/**
 * An interface defining a cache access object. This may be a redis cache, a simple in-memory
 * cache, or something else.
 */
export interface CacheInterface {
  /** Get a value from the cache, using the given function if the key is not set */
  get<T>(k: string, cb: () => Promise<T>, ttl?: number, log?: SimpleLoggerInterface): Promise<T>;
  get<T>(k: string, cb: () => T, ttl?: number, log?: SimpleLoggerInterface): T;

  /**
   * Clear one or more values from the cache. If `k` is a string, then it will clear _only_ that
   * key, if set. If `k` is a RegExp, it will clear any keys that match the RegExp.
   */
  clear(k: string | RegExp): void | unknown;
}

/**
 * An object that can be retrieved from or saved to a SQL database. Note that this is intended to
 * exclude complex values like class instances, etc.
 */
export type SqlObj = { [k: string]: SqlPrimitive };

/**
 * This is the defining type of this library. It is a type that you will define that establishes
 * the parameters of your data domain.
 *
 * This is a type that you would define within your own domain. It specifies a string type
 * identifier (`t`), together with the database type for that object. The string type identifier
 * should match the `type` parameter of the API type for the same object.
 *
 * In this structure, a "constraint" represents a unique or primary key. A constraint should
 * _always_ resolve to a single resource. For example, `{ id: 1 }` or `{ email: "me@email.com" }` or
 * `{ type: "users", id: "abcde" }`. A "filter" is a set of arbitrary key/value pairs that can be
 * interpreted into a SQL query that returns 0 or more results.
 *
 * In your domain, this would look something like the following:
 *
 * ```
 * export type TypeMap = {
 *   users: {
 *     type: MyDomain.Db.User;
 *     constraints:
 *       | { id: string }
 *       | { email: string };
 *     filters: {
 *       _t: "filter";
 *       emailLike?: string;
 *       nameLike?: string;
 *       dob?: ["lt"|"gt"|"eq", number]
 *     };
 *     defaults: typeof UserDefaults;
 *   };
 *   events: {
 *     type: MyDomain.Db.Event;
 *     constraints: { id: string };
 *     filters: NullFilter;
 *     defaults: typeof EventDefaults;
 *   }
 *   ....
 *
 * export const UserDefaults = {
 *   createdMs: () => Date.now(),
 *   primaryAddressId: null,
 * }
 *
 * export const EventDefaults = {
 *   createdMs: () => Date.now(),
 * }
 * ```
 */
export type GenericTypeMap<T extends SqlObj = {}> = {
  [t: string]: {
    type: T;
    constraints: { [k in keyof T]?: SqlPrimitive | undefined };
    filters: NullFilter;
    defaults: NoDefaults<T>;
  };
};

/** Convenience type defining a constraint on a standard `id` field */
export type IdConstraint = { id: string | number | Buffer | undefined | null };

/** Convenience type defining a filter with no possible values */
export type NullFilter = { _t: "filter" };

/**
 * Convenience type that can be used to indicate that there are no defaults for the given class.
 *
 * Note: This type is a bit of a misnomer. It will generally not be used in practice, but is here
 * to allow us to define sensible types for our abstract class.
 * */
export type NoDefaults<T extends SqlObj> = { [k in keyof T]?: DefaultVal };

/** The type of a value that may be passed as a default. */
export type DefaultVal = SqlPrimitive | (() => SqlPrimitive);

/** A technical, internal type that is used to make our Abstract class work. */
type Defaults<ResourceTypeMap extends GenericTypeMap> = {
  [T in keyof ResourceTypeMap]: ResourceTypeMap[T]["defaults"];
};

/** Helper for easily making filter types */
export type Filter<T> = { _t: "filter" } & { [K in keyof T]: undefined | null | T[K] };

/** Helper for setting an `id` default field to generate a buffer id */
export const buffId = { id: () => hexToBuffer(uuid()) };

/** Helper for setting an `id` default field to generate a string id */
export const strId = { id: () => uuid() };

/**
 * Helper for combining several default specifiers. This will typically be used in conjunction with
 * one of the above id helpers like so:
 *
 * ```
 * const defaults = {
 *   "my-type": both(buffId, { createdMs: () => Date.now() })
 * }
 * ```
 *
 * This results in the type
 *
 * ```
 * {
 *   "my-type": {
 *     id: () => Buffer;
 *     createdMs: () => number;
 *   }
 * }
 * ```
 */
export const both = <A, B>(a: A, b: B) => ({ ...a, ...b });

/**
 * An interface without all the internal methods of the class.
 *
 * Since typescript (disappointingly) includes protected/private methods and properites when using
 * a class as an interface, we define this "lightweight" interface for use in function parameter
 * definitions, so as to narrow the interface to only public methods.
 */
export interface SqlInterface<ResourceTypeMap extends GenericTypeMap> {
  get<T extends keyof ResourceTypeMap>(
    t: T,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"], any, { pg: Api.NextPageParams }>>;
  get<T extends keyof ResourceTypeMap>(
    t: T,
    params: Api.Server.CollectionParams | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"], any, { pg: Api.NextPageParams }>>;
  get<T extends keyof ResourceTypeMap>(
    t: T,
    filter: ResourceTypeMap[T]["filters"] | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"], any, { pg: Api.NextPageParams }>>;
  get<T extends keyof ResourceTypeMap>(
    t: T,
    filter: ResourceTypeMap[T]["filters"] | undefined | null,
    params: Api.Server.CollectionParams | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"], any, { pg: Api.NextPageParams }>>;
  get<T extends keyof ResourceTypeMap>(
    t: T,
    constraint: ResourceTypeMap[T]["constraints"],
    log: SimpleLoggerInterface,
    thrw: true
  ): Promise<ResourceTypeMap[T]["type"]>;
  get<T extends keyof ResourceTypeMap>(
    t: T,
    constraint: ResourceTypeMap[T]["constraints"],
    log: SimpleLoggerInterface,
    thrw?: false
  ): Promise<ResourceTypeMap[T]["type"] | undefined>;

  save<T extends keyof ResourceTypeMap>(
    t: T,
    _resource: PartialSelect<ResourceTypeMap[T]["type"], keyof ResourceTypeMap[T]["defaults"]>,
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface,
    currentResource?: ResourceTypeMap[T]["type"]
  ): Promise<ResourceTypeMap[T]["type"]>;

  update<T extends keyof ResourceTypeMap>(
    t: T,
    pkVal: string | Buffer,
    _resource: Partial<ResourceTypeMap[T]["type"]>,
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<ResourceTypeMap[T]["type"]>;

  delete<T extends keyof ResourceTypeMap>(
    t: T,
    filter: ResourceTypeMap[T]["filters"],
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<void>;
  delete<T extends keyof ResourceTypeMap>(
    t: T,
    constraint: ResourceTypeMap[T]["constraints"],
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<void>;
}

/**
 * A very simple, not very powerful SQL Query object. Note that the keyword for each of these
 * sections will be provided, so the value for `limit`, for example, would be something like
 * `20,10`, rather than `LIMIT 20,10`.
 *
 * This is exported mainly so you can more easily define the override of certain methods.
 */
export type Query = SelectQuery | DeleteQuery;
export type SelectQuery = {
  t: "select";
  select: Array<string>;
  join?: undefined | null | Array<string>;
  groupby?: undefined | null | Array<string>;
  having?: undefined | null | Array<string>;
} & QueryCommon;
export type DeleteQuery = {
  t: "delete";
} & QueryCommon;
export type QueryCommon = {
  from: string;
  where?: undefined | null | Array<string>;
  params?: undefined | null | Array<SqlValue>;
  limit?: undefined | null | string;
  sort?: undefined | null | Array<string>;
};

/**
 * ## AbstractSql
 *
 * Extend this abstract class to create a final sql data access class that is highly constrained to
 * your defined type ecosystem. This class attempts to make it trivial to get, save and delete
 * well-typed SQL objects.
 *
 * **NOTE: This is not intended to be purely type-safe!!** There are certain things that just aren't
 * that feasible, and so there is still the possibility of runtime exceptions if you're not careful.
 * In particular:
 *
 * * Filters are assumed to be column names by default, but do not have to be. For example, you can
 *   define a filter as `{ idIn: Array<string> }` and the class will happily write sql like
 *   `SELECT ... WHERE idIn in (?)`. You need to override the `getSqlForFilterField` to change this
 *   behavior.
 */
export abstract class AbstractSql<ResourceTypeMap extends GenericTypeMap>
  implements SqlInterface<ResourceTypeMap>
{
  /** The actual sql db connection */
  protected db: SimpleSqlDbInterface;

  /**
   * A cache object. Note that this can be a fake or "pass-through" cache if cache functionality is
   * not desired.
   */
  protected cache: CacheInterface;

  /**
   * Whether to automatically convert buffers of length 16 to UUIDs and UUIDs to buffers (on save).
   * This setting can be somewhat problematic.
   */
  protected convertBuffersAndHex: boolean = true;

  /**
   * Define a map for types to table names. Any types that are not found in this map are assumed
   * to be the actual name of their tables. (e.g., type `users` is assumed to be the `users` table)
   *
   * You will probably override this with your actual table map (if necessary) when you extend this
   * class.
   */
  protected tableMap: { [k in keyof ResourceTypeMap]?: string } = {};

  /**
   * Define default values for fields of various types. You should override this with your actual
   * defaults when you extend this class.
   */
  protected defaults: Defaults<ResourceTypeMap>;

  /**
   * Define wich fields are relationships for any given type. The string value indicated for each
   * field should be the type that objects of this relationship have.
   *
   * This determines how change sets are created and published for auditing purposes.
   *
   * For example, if users have a "bestFriend" relationship, then:
   *
   * ```
   * protected resourceRelationships: {
   *   "users": {
   *     "bestFriend": "users"
   *   }
   * }
   * ```
   */
  protected resourceRelationships: {
    [k in keyof ResourceTypeMap]?: { [field: string]: string };
  } = {};

  /**
   * If any tables have alternate PKs, define them here (default is `id`). (At this time, this does
   * not support compound keys.)
   */
  protected primaryKeys: { [K in keyof ResourceTypeMap]?: keyof ResourceTypeMap[K]["type"] } = {};

  /**
   * Set the default page size
   */
  protected defaultPageSize = 25;

  /**
   * (Optional) Auditor client. If you set this to an auditor client that is connected to a message
   * queue, this allows you to flow data mutations into an auditing system.
   */
  protected audit: Audit.ClientInterface | null = null;

  /**
   * (Optional) Pubsub. This allows the service to publish friendlier "domain" messages about
   * data events. Note that this is largely the same data as the audit client, but the format
   * will be easier to use, and it additionally allows some separation between an auditing
   * system and a more generalized data environment.
   *
   * While you may utilize these messages in whatever way you like, a common way to use the data
   * would be to publish a message with subject `${domain}.${action}.${resource.type}`.
   */
  protected pubsub: null | {
    publish(msg: { action: string; resource: { type: string } }): Promise<unknown>;
  } = null;

  /**
   * Get a resource
   *
   * This accommodates collections (optionally filtered and sorted) as well as single resources by
   * constraint.
   *
   * Filters and constraints are passed down to lower-level processing functions which can be
   * overridden in derivative classes.
   *
   * For getting a single resource using a constraint, you can additionally define whether you want
   * the system to throw a 404 error if no result is returned.
   */
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"], any, { pg: Api.NextPageParams }>>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    params: Api.Server.CollectionParams | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"], any, { pg: Api.NextPageParams }>>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    filter: ResourceTypeMap[T]["filters"] | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"], any, { pg: Api.NextPageParams }>>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    filter: ResourceTypeMap[T]["filters"] | undefined | null,
    params: Api.Server.CollectionParams | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"], any, { pg: Api.NextPageParams }>>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    constraint: ResourceTypeMap[T]["constraints"],
    log: SimpleLoggerInterface,
    thrw: true
  ): Promise<ResourceTypeMap[T]["type"]>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    constraint: ResourceTypeMap[T]["constraints"],
    log: SimpleLoggerInterface,
    thrw?: false
  ): Promise<ResourceTypeMap[T]["type"] | undefined>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    logParamsFilterConstraint:
      | SimpleLoggerInterface
      | Api.Server.CollectionParams
      | ResourceTypeMap[T]["filters"]
      | ResourceTypeMap[T]["constraints"]
      | undefined
      | null,
    logOrParams?: SimpleLoggerInterface | Api.Server.CollectionParams | undefined | null,
    logOrThrw?: boolean | undefined | SimpleLoggerInterface
  ): Promise<
    | Api.CollectionResponse<ResourceTypeMap[T]["type"], any, { pg: Api.NextPageParams }>
    | ResourceTypeMap[T]["type"]
    | undefined
  > {
    const {
      log,
      thrw,
      collectionParams,
      constraint: _constraint,
      filter,
    } = this.assignParams<T>([logParamsFilterConstraint, logOrParams, logOrThrw]);
    const table = <string>(this.tableMap[t] || this.sanitizeFieldName(t as string));
    const tableAlias = table.slice(0, 2);

    let query: SelectQuery = {
      t: "select",
      select: [`\`${tableAlias}\`.*`],
      from: `\`${table}\` AS \`${tableAlias}\``,
    };

    if (filter || !_constraint) {
      log.debug(`Getting ${String(t)} by filter '${JSON.stringify(filter)}'`);

      // Apply filter
      if (filter && Object.keys(filter).filter((k) => k !== "_t").length > 0) {
        // Turn the filters into a more complicated query
        for (const field in filter) {
          if (filter[field] !== undefined) {
            query = this.mergeQuery<SelectQuery>(
              query,
              this.getSqlForFilterField(t, field, filter[field])
            );
          }
        }
      }

      // Apply pagination and sort
      const paramData = this.processCollectionParams(t, collectionParams);
      query = this.mergeQuery<SelectQuery>(query, paramData.query);

      // Compose query
      const { queryStr, params } = this.composeSql(query);

      // Now execute the query and return
      log.debug(`Final query: ${queryStr}; Params: ${JSON.stringify(params)}`);
      const { rows } = await this.db.query<ResourceTypeMap[T]["type"]>(queryStr, params);
      log.debug(`Returning ${rows.length} ${String(t)}`);

      const data: Array<ResourceTypeMap[T]["type"]> = this.convertBuffersAndHex
        ? rows.map((r) => this.buffersToHex(r))
        : rows;

      return {
        t: "collection",
        data,
        meta: {
          pg: {
            ...paramData.meta,
            nextCursor: data.length < paramData.meta.size ? null : paramData.meta.nextCursor,
          },
        },
      };
    } else {
      const constraint = this.processConstraint(t, _constraint);

      // Validate
      if (constraint.where.length === 0) {
        throw new E.InternalServerError(
          `No constraints passed for resource '${String(t)}'. Constraint: ${JSON.stringify(
            _constraint
          )}`
        );
      }

      log.debug(`Getting ${String(t)} using ${JSON.stringify(constraint)} from database`);

      // If there's one or more undefined param, we can't use it
      if (constraint.params.filter((v) => v === undefined).length > 0) {
        log.info(`Constraint is incomplete. Cannot use. ${JSON.stringify(constraint)}`);
        if (thrw) {
          throw new E.NotFound(
            `No constraint value passed for ${String(t)}, so the resource cannot be found.`
          );
        } else {
          return Promise.resolve(undefined);
        }
      }

      return this.cache.get<ResourceTypeMap[T]["type"]>(
        `${String(t)}-${JSON.stringify(constraint)}`,
        async () => {
          // Compose query
          query = this.mergeQuery<SelectQuery>(query, <Partial<SelectQuery>>constraint);
          const { queryStr, params } = this.composeSql(query);

          // Execute
          log.debug(`Final query: ${queryStr}; Params: ${JSON.stringify(params)}`);
          const { rows } = await this.db.query<ResourceTypeMap[T]["type"]>(queryStr, params);

          if (rows.length === 0) {
            if (thrw) {
              throw new E.NotFound(`${String(t)} not found for the given parameters`);
            } else {
              return undefined;
            }
          }

          // Warn if more than one found
          if (rows.length > 1) {
            log.warning(
              `More than one ${String(
                t
              )} found when searching with constraint: Query: ${queryStr}; ` +
                `Params: ${JSON.stringify(params)}`
            );
          }

          return this.convertBuffersAndHex ? this.buffersToHex(rows[0]) : rows[0];
        },
        undefined,
        log
      );
    }
  }

  /**
   * Default method for translating filter fields into SQL. This should be overridden for
   * domain-specific filters. For example, if you want to be able to get collections of users
   * filtered by name, you might have a filter like `{ _t: "filter", nameLike: string }`. You
   * would then override this method and handle the `nameLike` field for objects of type `users`,
   * calling back to this default implementation for any other field.
   */
  protected getSqlForFilterField<T extends keyof ResourceTypeMap>(
    t: T,
    field: string,
    val: any
  ): Partial<QueryCommon> {
    // Ignore the special '_t' tag
    if (field === "_t") {
      return {};
    }

    // Sanitize field (shouldn't be necessary, but high-stakes, so we're doing it)
    field = this.sanitizeFieldName(field);
    if (Array.isArray(val)) {
      // If we're dealing with an array, use a set
      return {
        where: ["`" + field + "` IN (?)"],
        params: [val],
      };
    } else {
      // Otherwise, use an equals (or "IS NULL")
      if (val === null) {
        return { where: ["`" + field + "` IS NULL"] };
      } else {
        return {
          where: ["`" + field + "` = ?"],
          params: [val],
        };
      }
    }
  }

  /**
   * Return query parts derived from the passed in collection params. Note: This library only
   * supports number-based cursors at this time. For any other cursor scheme, just override
   * this method.
   */
  protected processCollectionParams<T extends keyof ResourceTypeMap>(
    t: T,
    params: undefined | Api.Server.CollectionParams
  ): { meta: Api.NextPageParams; query: Partial<QueryCommon> } {
    const query: Partial<QueryCommon> = {};

    const pg = params?.__pg;
    const sort = params?.__sort?.trim();

    let num = 1;
    const size = pg?.size || this.defaultPageSize;
    const _cursor = pg?.cursor || null;

    // Pagination
    if (pg) {
      if (_cursor) {
        const cursor = Buffer.from(_cursor, "base64").toString("utf8");
        const match = cursor.match(/^num:([1-9][0-9]*)$/);
        if (!match) {
          throw new E.BadRequest(
            `Invalid cursor: '${_cursor}'. Cursors are expected to be base64-encoded uris ` +
              `matching the regex /^num:[1-9][0-9]*$/.`
          );
        }
        num = Number(match[1]);
      }
      query.limit = `${(num - 1) * size}, ${size}`;
    } else {
      // Default to first page and ${defaultPageSize} results
      query.limit = `0, ${this.defaultPageSize}`;
    }
    const nextCursor = Buffer.from(`num:${num + 1}`, "utf8").toString("base64");

    // Sort
    if (sort) {
      query.sort = this.parseSort(t, sort).map(
        (s) => `\`${this.sanitizeFieldName(s[0])}\` ${s[1]}`
      );
    }

    // Return
    return {
      query,
      meta: {
        size,
        sort,
        prevCursor: _cursor,
        nextCursor,
      },
    };
  }

  /**
   * Parse a sort string
   *
   * This is a generic method that can be overridden by descendent classes to provide validation
   * for sort fields. By default, all it will do is parse the fields out. It will not actually
   * validate that the given fields exist on the given object.
   */
  protected parseSort<T extends keyof ResourceTypeMap>(
    t: T,
    sortStr: string
  ): Array<[string, "ASC" | "DESC"]> {
    const sort: Array<[string, "ASC" | "DESC"]> = [];
    const clauses = sortStr.split(/[\s]*,[\s]*/).filter((s) => s !== "");
    for (const clause of clauses) {
      const match = clause.match(/^([+-]?)(.+)$/);
      if (!match) {
        throw new E.BadRequest(
          `Invalid sort clause: '${clause}'. Sort must be a comma-separated list of clauses ` +
            `matching the regex /^([+-]?)(.+)$/`
        );
      }
      sort.push([match[2], sortDir[match[1]]]);
    }
    return sort;
  }

  /**
   * Turn a passed in constraint object into a partial Query
   */
  protected processConstraint<T extends keyof ResourceTypeMap>(
    t: T,
    obj: { [k: string]: SqlPrimitive | undefined }
  ): { where: Array<string>; params: Array<SqlPrimitive | undefined> } {
    const where = Object.keys(obj).map((k) => `\`${k}\` = ?`);
    const params = Object.values(obj);
    return { where, params };
  }

  /**
   * Compose a final SQL query from the given query object
   */
  protected composeSql(q: Query): { queryStr: string; params: Array<SqlValue> | undefined } {
    return q.t === "select"
      ? {
          queryStr:
            `SELECT ${q.select.join(", ")} ` +
            `FROM ${q.from}` +
            (q.join && q.join.length > 0 ? ` JOIN ${q.join.join(" JOIN ")}` : "") +
            (q.where && q.where.length > 0 ? ` WHERE (${q.where.join(") && (")})` : "") +
            (q.groupby && q.groupby.length > 0 ? ` GROUP BY ${q.groupby.join(", ")}` : "") +
            (q.having && q.having.length > 0 ? ` HAVING (${q.having.join(") && (")})` : "") +
            (q.sort && q.sort.length > 0 ? ` ORDER BY ${q.sort.join(", ")}` : "") +
            (q.limit ? ` LIMIT ${q.limit}` : ""),
          params: q.params && q.params.length > 0 ? q.params : undefined,
        }
      : {
          queryStr:
            `DELETE ` +
            `FROM ${q.from}` +
            (q.where && q.where.length > 0 ? ` WHERE (${q.where.join(") && (")})` : "") +
            (q.sort && q.sort.length > 0 ? ` ORDER BY ${q.sort.join(", ")}` : "") +
            (q.limit ? ` LIMIT ${q.limit}` : ""),
          params: q.params && q.params.length > 0 ? q.params : undefined,
        };
  }

  protected sanitizeFieldName(field: string): string {
    return field.replace(/[`'"]+|--+/g, "");
  }

  protected isFilter<T extends keyof ResourceTypeMap>(f: any): f is ResourceTypeMap[T]["filters"] {
    return f._t === "filter";
  }

  /**
   * Save changes of the given resource to the database, throwing a 404 error if no object is found
   * for the given primary key. This method expects the resource to exist in the database. It then
   * retrieves it and diffs the incoming object against that pulled from the database. It saves any
   * changes using the [[`save`]] method. This additionally emits data mutation events.
   */
  public async update<T extends keyof ResourceTypeMap>(
    t: T,
    pkVal: string | Buffer,
    _resource: Partial<ResourceTypeMap[T]["type"]>,
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<ResourceTypeMap[T]["type"]> {
    const pk = <keyof ResourceTypeMap[T]["type"]>(this.primaryKeys[t] || "id");
    const pkValStr = Buffer.isBuffer(pkVal) ? this.bufferToUuid(pkVal) : `${pkVal}`;
    log.info(`Updating ${String(t)}:'${pkValStr}'`);

    const currentResource = await this.get(t, { [pk]: pkVal }, log, false);
    if (!currentResource) {
      throw new E.NotFound(
        `Resource of type '${String(t)}', ${String(pk)} '${pkValStr}', was not found.`,
        `RESOURCE-NOT-FOUND.${(t as string).toUpperCase()}`
      );
    }

    // Remove the id field, since we don't want accidental changes
    const resourceWithoutId = { ..._resource };
    delete resourceWithoutId[pk];

    const resource: ResourceTypeMap[T]["type"] = {
      ...currentResource,
      ...resourceWithoutId,
    };

    return await this.save(t, resource, auth, log, currentResource);
  }

  /**
   * Save the given object. If an object already exists for this object's primary key, then incoming
   * values are diffed against this existing object and the record is updated. Otherwise, the
   * record is saved as a new object, using any defaults specified to fill in values for omitted
   * fields.
   *
   * Note that the difference between this method and the [[`update`]] method is that the update
   * method _expects_ the object to already exist and throws an error if it doesn't. This method
   * does not require the object to exist.
   *
   * Note also that this method will not use any defaults if an existing object is found.
   */
  public async save<T extends keyof ResourceTypeMap>(
    t: T,
    _resource: PartialSelect<ResourceTypeMap[T]["type"], keyof ResourceTypeMap[T]["defaults"]>,
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface,
    currentResource?: ResourceTypeMap[T]["type"]
  ): Promise<ResourceTypeMap[T]["type"]> {
    const pk = <keyof ResourceTypeMap[T]["type"]>(this.primaryKeys[t] || "id");
    log.info(`Saving resource '${String(t)}${_resource[pk] ? `:${_resource[pk]}` : ""}'`);

    if (!currentResource && _resource[pk]) {
      currentResource = await this.get(t, { [pk]: _resource[pk] }, log, false);
    }

    let resource: ResourceTypeMap[T]["type"];

    // If this is a new resource, fill in defaults
    if (!currentResource) {
      resource = {
        ...this.getDefaults(t),
        ..._resource,
      };
    } else {
      // Otherwise, fill the resource in with the existing resource
      resource = {
        ...currentResource,
        ..._resource,
      };
    }

    // Aggregate and format changes
    const changes: Audit.Changes<ResourceTypeMap[T]["type"]> = {};
    for (const k of <Array<keyof ResourceTypeMap[T]["type"]>>Object.keys(resource)) {
      // If it's not pertinent or it hasn't changed, skip
      // TODO: Handle non-primitives, like Buffers and Dates
      if (currentResource && resource[k] === currentResource[k]) {
        continue;
      }

      const v = resource[k];

      // Rels
      const rels = this.resourceRelationships[t];
      if (rels && rels[<string>k]) {
        changes[k] = {
          t: "rel",
          action:
            !currentResource || (currentResource[k] === null && v !== null)
              ? "added"
              : currentResource && currentResource[k] !== null && v === null
              ? "deleted"
              : "changed",
          relType: rels[<string>k],
          relId: <string>(Buffer.isBuffer(v) ? v.toString("hex") : v),
        };
      } else {
        changes[k] = {
          t: "attr",
          prev: currentResource ? currentResource[k] : null,
          next: v!,
        };
      }
    }

    // If nothing has changed, just return
    if (Object.keys(changes).length === 0 && currentResource !== undefined) {
      return resource;
    }

    // Otherwise, insert/update
    const table = this.tableMap[t] || this.sanitizeFieldName(<string>t);
    if (currentResource) {
      const updates = Object.keys(changes)
        .filter((k) => k !== pk)
        .reduce<Audit.Changes<ResourceTypeMap[T]["type"]>>((u, _k) => {
          const k = <keyof ResourceTypeMap[T]["type"]>_k;
          u[k] = changes[k];
          return u;
        }, {});

      // prettier-ignore
      const query = "UPDATE `" + table + "` " +
        `SET ${Object.keys(updates).map(k => `\`${k}\` = ?`).join(", ")} ` +
        "WHERE `" + String(pk) + "` = ?";
      const params = [
        ...Object.keys(updates).map((k) => {
          const v = updates[<keyof typeof updates>k]!;
          if (v.t === "attr") {
            return (v as any).next;
          } else {
            return (v as any).action === "deleted" ? null : (v as any).relId;
          }
        }),
        resource[pk],
      ];
      await this.db.query(query, params);
    } else {
      // prettier-ignore
      const query = "INSERT INTO `" + table + "` " +
        "(`" + Object.keys(changes).join("`, `") + "`) VALUES (?)";
      const params = [
        Object.keys(changes).map((k) => {
          const v = changes[<keyof typeof changes>k]!;
          if (v.t === "attr") {
            return (v as any).next;
          } else {
            return (v as any).action === "deleted" ? null : (v as any).relId;
          }
        }),
      ];
      //console.log(query, params);
      await this.db.query(query, params);
    }

    // Bust cache
    this.cache.clear(new RegExp(`${String(t)}-.*`));

    // Publish audit message
    const p: Array<Promise<unknown>> = [];
    if (this.audit) {
      const id = resource[pk];
      const targetType = <string>t;
      const targetId = Buffer.isBuffer(id) ? id.toString("hex") : `${id}`;
      log.debug(`Publishing audit message`);
      if (currentResource) {
        p.push(
          this.audit.update<ResourceTypeMap[T]["type"]>({
            auth,
            targetType,
            targetId,
            changes,
          })
        );
      } else {
        p.push(
          this.audit.create({
            auth,
            targetType,
            targetId,
          })
        );
      }
    }

    // Publish domain message
    if (this.pubsub) {
      log.debug(`Publishing domain message`);
      p.push(
        this.pubsub.publish({
          action: currentResource ? "updated" : "created",
          resource: { type: <string>t, ...resource },
        })
      );
    }

    await Promise.all(p);
    return resource;
  }

  /**
   * Delete the given resource
   */
  public delete<T extends keyof ResourceTypeMap>(
    t: T,
    filter: ResourceTypeMap[T]["filters"],
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<void>;
  public delete<T extends keyof ResourceTypeMap>(
    t: T,
    constraint: ResourceTypeMap[T]["constraints"],
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<void>;
  public async delete<T extends keyof ResourceTypeMap>(
    t: T,
    filterOrConstraint: ResourceTypeMap[T]["filters"] | ResourceTypeMap[T]["constraints"],
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<void> {
    let loop = true;
    const pgSize = 1000;

    // Since we're deleting records, we're _consuming_ pages, not traversing. Therefore,
    // we're always on page 1 until we've deleted all the records.
    const collectionParams: Api.Server.CollectionParams = {
      __pg: { size: pgSize },
    };

    // Delete in batches, since we have to publish deletion messages for each
    while (loop) {
      // Get resource(s) using filter or constraint
      let resources: Array<ResourceTypeMap[T]["type"]> = [];
      if (!this.isFilter<T>(filterOrConstraint)) {
        log.debug(`Getting resource to delete by constraint`);
        const res = await this.get(t, filterOrConstraint, log, false);
        resources = res ? [res] : [];
        loop = false;
      } else {
        log.debug(`Getting resource(s) to delete by filter`);
        const res = await this.get(t, filterOrConstraint, collectionParams, log);
        resources = res.data;

        // Loop until we've gotten the last page of resources
        loop = resources.length >= pgSize;
      }

      // Process resource deletion
      if (resources.length === 0) {
        log.info(`Resource(s) not found. Nothing to delete.`);
      } else {
        log.debug(`Deleting ${resources.length} ${String(t)}`);

        // Apply filter or constraint
        let query: DeleteQuery = {
          t: "delete",
          from: "`" + (this.tableMap[t]! || this.sanitizeFieldName(t as string)) + "`",
          limit: String(pgSize),
        };
        if (this.isFilter<T>(filterOrConstraint)) {
          if (Object.keys(filterOrConstraint).filter((k) => k !== "_t").length > 0) {
            // Turn the filters into a more complicated query
            const filter = filterOrConstraint;
            for (const field in filter) {
              if (filter[field] !== undefined) {
                query = this.mergeQuery<DeleteQuery>(
                  query,
                  this.getSqlForFilterField(t, field, filter[field])
                );
              }
            }
          }
        } else {
          const constraint = this.processConstraint(t, filterOrConstraint);

          // Validate
          if (constraint.where.length === 0) {
            throw new E.InternalServerError(
              `No constraints passed for deleting resource '${String(
                t
              )}'. Constraint: ${JSON.stringify(filterOrConstraint)}`
            );
          }

          log.debug(`Deleting ${String(t)} from database using ${JSON.stringify(constraint)}`);

          // If there's one or more undefined param, we can't use it
          if (constraint.params.filter((v) => v === undefined).length > 0) {
            log.info(`Constraint is incomplete. Cannot use. ${JSON.stringify(constraint)}`);
            throw new E.NotFound(
              `No constraint value passed for ${String(t)}, so the resource cannot be found.`
            );
          }

          query = this.mergeQuery<DeleteQuery>(query, <Partial<DeleteQuery>>constraint);
        }

        // Compose query
        const { queryStr, params } = this.composeSql(query);

        // Execute
        log.debug(`Final query: ${queryStr}; Params: ${JSON.stringify(params)}`);
        await this.db.query(queryStr, params);

        log.debug(`Resource(s) deleted; publishing messages`);

        // Bust cache
        this.cache.clear(new RegExp(`${String(t)}-.*`));

        // Publish messages
        const p: Array<Promise<unknown>> = [];
        for (let i = 0; i < resources.length; i++) {
          // Publish audit message
          const resource = resources[i];
          const pk = <keyof ResourceTypeMap[T]["type"]>(this.primaryKeys[t] || "id");
          const pkVal = resource[pk];
          const pkValStr = Buffer.isBuffer(pkVal) ? this.bufferToUuid(pkVal) : `${pkVal}`;
          if (this.audit) {
            const targetType = <string>t;
            log.debug(`Publishing audit message`);
            p.push(
              this.audit.delete({
                auth,
                targetType,
                targetId: pkValStr,
              })
            );
          }

          // Publish domain message
          if (this.pubsub) {
            log.debug(`Publishing domain message`);
            p.push(
              this.pubsub
                .publish({
                  action: "deleted",
                  resource: { type: <string>t, ...resource },
                })
                .catch((e) => {
                  log.error(
                    `Couldn't publish migration message for 'deleted' resource: ${JSON.stringify(
                      resource
                    )}`
                  );
                })
            );
          }
        }

        // Wait for message publishing to complete
        await Promise.all(p);
      }
    }
  }

  /**
   * Gets an object with concrete values to use as defaults for the given resource
   */
  protected getDefaults<T extends keyof ResourceTypeMap>(
    t: T
  ): { [K in keyof Defaults<ResourceTypeMap>[T]]: T[K] } {
    const defaults: any = {};
    for (const k in this.defaults[t]) {
      const val = this.defaults[t][k];
      defaults[k] = typeof val === "function" ? val() : val;
    }
    return defaults;
  }

  /**
   * Takes two Query objects and merges them together into one
   */
  protected mergeQuery<Q extends Query>(base: Q, add: Partial<Q>): Q {
    // Copy base into new object
    const result: Q = { ...base };

    if (add.where) {
      result.where = [...(result.where || []), ...(<Array<string>>(add.where || []))];
    }
    if (add.params) {
      result.params = [...(result.params || []), ...(<Array<SqlValue>>(add.params || []))];
    }
    if (add.limit) {
      result.limit = add.limit;
    }
    if (add.sort) {
      result.sort = [...(result.sort || []), ...(<Array<string>>(add.sort || []))];
    }

    // Select-specific terms
    if (result.t === "select") {
      // Stupidly have to cast to satisfy stupid typescript......
      const _add = <Partial<SelectQuery>>add;
      result.select = [...result.select, ...(_add.select || [])];

      if (_add.join) {
        result.join = [...(result.join || []), ...(_add.join || [])];
      }
      if (_add.groupby) {
        result.groupby = [...(result.groupby || []), ...(_add.groupby || [])];
      }
      if (_add.having) {
        result.having = [...(result.having || []), ...(_add.having || [])];
      }
    }

    return result;
  }

  /**
   * An internal method for untangling parameters for the `get` method. The `get` method has so
   * many possible signatures that it was far too complicated to this within the method itself.
   */
  private assignParams<T extends keyof ResourceTypeMap>(
    opts: [
      (
        | SimpleLoggerInterface
        | Api.Server.CollectionParams
        | ResourceTypeMap[T]["filters"]
        | ResourceTypeMap[T]["constraints"]
        | undefined
        | null
      ),
      SimpleLoggerInterface | Api.Server.CollectionParams | undefined | null,
      SimpleLoggerInterface | boolean | undefined
    ]
  ): {
    log: SimpleLoggerInterface;
    thrw: boolean;
    collectionParams: Api.Server.CollectionParams | undefined;
    constraint: ResourceTypeMap[T]["constraints"] | undefined;
    filter: ResourceTypeMap[T]["filters"] | undefined;
  } {
    const logIndex = isLog(opts[0]) ? 0 : isLog(opts[1]) ? 1 : 2;
    const log = <SimpleLoggerInterface>opts[logIndex];

    const others = <
      [
        (
          | ResourceTypeMap[T]["filters"]
          | ResourceTypeMap[T]["constraints"]
          | Api.Server.CollectionParams
          | undefined
          | null
        ),
        Api.Server.CollectionParams | boolean | undefined | null
      ]
    >(logIndex === 0
      ? [opts[1], opts[2]]
      : logIndex === 1
      ? [opts[0], opts[2]]
      : [opts[0], opts[1]]);

    const thrw = typeof others[1] === "boolean" ? others[1] : false;

    // If neither of the other two parameters were passed, then just return what we've got
    if (
      (typeof others[0] === "undefined" || others[0] === null) &&
      (typeof others[1] === "undefined" || others[1] === null)
    ) {
      return {
        log,
        thrw,
        collectionParams: undefined,
        constraint: undefined,
        filter: undefined,
      };
    }

    // Now, others[0] could be Server.CollectionParams, filters or constraints
    const filterOrConstraintOrParams = others[0];
    if (this.isFilter<T>(filterOrConstraintOrParams)) {
      return {
        log,
        thrw,
        filter: filterOrConstraintOrParams,
        collectionParams: <Api.Server.CollectionParams | undefined>(others[1] || undefined),
        constraint: undefined,
      };
    } else {
      return {
        log,
        thrw,
        filter: undefined,
        ...(isCollectionParams(others[0])
          ? { collectionParams: others[0], constraint: undefined }
          : { collectionParams: undefined, constraint: others[0] || undefined }),
      };
    }
  }

  /**
   * This function finds all buffers and converts them to hex strings. If the given value is 16 bits
   * long, is not in the `params.notUuids` array, or `params.notUuids` is undefined, the resulting
   * string is formatted as a uuid.
   *
   * NOTE: Typescript makes it almost impossible to do things like this, so we're going to disable it
   * for this function. This makes this operation wholly un-typesafe, but this functionality is so
   * convenient that we deem it worthwhile.
   */
  public buffersToHex<T, Except extends keyof T | undefined>(
    _obj: T,
    params?: {
      notUuid?: true | Array<keyof T>;
      not?: Array<Except>;
    }
  ): { [K in keyof T]: T[K] extends Buffer ? (K extends Except ? Buffer : string) : T[K] } {
    const obj: any = { ..._obj };
    for (const k in obj) {
      const v = obj[k];
      if (Buffer.isBuffer(v) && !params?.not?.includes(k as any)) {
        if (
          v.length === 16 &&
          params?.notUuid !== true &&
          (!Array.isArray(params?.notUuid) || !params?.notUuid?.includes(k as any))
        ) {
          obj[k] = this.bufferToUuid(v);
        } else {
          obj[k] = v.toString("hex");
        }
      }
    }
    return obj;
  }

  /**
   * This function takes any string that looks like a hex string and converts it to a buffer.
   *
   * Unfortunately, there's no way to easily figure out _which_ keys will be converted, since we're
   * doing some actual string analysis here. Need to come back to this.
   * TODO: Create better typing parameters for hexToBuffers
   *
   * NOTE: Typescript makes it almost impossible to do things like this, so we're going to disable it
   * for this function. This makes this operation wholly un-typesafe, but this functionality is so
   * convenient that we deem it worthwhile.
   */
  public hexToBuffers<T extends { [k: string]: unknown }, Converted extends keyof T | undefined>(
    _obj: T
  ): Converted extends undefined ? T : { [K in keyof T]: K extends Converted ? Buffer : T[K] } {
    const obj: any = { ..._obj };
    for (const k in obj) {
      if (typeof obj[k] === "string" && !obj[k].replace(/-/g, "").match(/[^a-fA-F0-9]/)) {
        obj[k] = this.hexToBuffer(obj[k]);
      }
    }
    return obj;
  }

  /**
   * Convenience function for converting a buffer to a formatted uuid. Note that no actual
   * validation is performed. If the given string is more than 16 bits, you'll get a uuid plus
   * whatever extra there was.
   *
   * @deprecated use the exported convenience functions instead
   */
  public bufferToUuid(buf: Buffer): string {
    return bufferToUuid(buf);
  }

  /**
   * Converts a hex string with possible dashes to a buffer
   *
   * @deprecated use the exported convenience functions instead
   */
  public hexToBuffer(hex: string): Buffer {
    return hexToBuffer(hex);
  }

  /**
   * Convenience export of the uuid function, optionally converting to buffer
   */
  public uuid(t: "string"): string;
  public uuid(t?: "buffer"): Buffer;
  public uuid(t?: "buffer" | "string"): Buffer | string {
    const id = uuid();
    return t && t === "string" ? id : this.hexToBuffer(id);
  }
}

/**
 * Convenience function for converting a buffer to a formatted uuid. Note that no actual
 * validation is performed. If the given string is more than 16 bits, you'll get a uuid plus
 * whatever extra there was.
 */
export const bufferToUuid = (buf: Buffer): string => {
  return `${bite(buf, 0, 4)}-${bite(buf, 4, 6)}-${bite(buf, 6, 8)}-${bite(buf, 8, 10)}-${bite(
    buf,
    10
  )}`;
};

/**
 * Converts a hex string with possible dashes to a buffer
 */
export const hexToBuffer = (hex: string): Buffer => {
  return Buffer.from(hex.replace(/-/g, ""), "hex");
};

const isLog = (thing: any): thing is SimpleLoggerInterface => {
  return thing && thing.debug && thing.info && thing.notice && thing.error;
};
const isCollectionParams = (thing: any): thing is Api.Server.CollectionParams => {
  const pg = thing?.__pg;
  const sort = thing?.__sort;
  return thing && (Object.keys(thing).length === 0 || pg !== undefined || sort !== undefined);
};

const sortDir: { [k: string]: "ASC" | "DESC" } = {
  "": "ASC",
  "+": "ASC",
  "-": "DESC",
};

export const bite = (buf: Buffer, i: number, j?: number): string => buf.slice(i, j).toString("hex");
