import { v6 as uuid } from "uuid-with-v6";
import {
  SimpleSqlDbInterface,
  SqlValue,
  SqlPrimitive,
  SimpleLoggerInterface,
} from "@wymp/ts-simple-interfaces";
import * as E from "@openfinanceio/http-errors";
import { Api, Auth, Audit, PartialSelect } from "@wymp/types";

export { uuid };

export interface CacheInterface {
  get<T>(k: string, cb: () => Promise<T>, ttl?: number, log?: SimpleLoggerInterface): Promise<T>;
  get<T>(k: string, cb: () => T, ttl?: number, log?: SimpleLoggerInterface): T;
  clear(k: string | RegExp): void | unknown;
}

export type SqlObj = { [k: string]: SqlPrimitive };

/**
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
 */
export type GenericTypeMap<T extends SqlObj = {}> = {
  [t: string]: {
    type: T;
    constraints: { [k in keyof T]?: SqlPrimitive | undefined };
    filters: NullFilter;
    defaults: NoDefaults<T>;
  };
};

export type IdConstraint = { id: string | number | Buffer | undefined | null };
export type NullFilter = { _t: "filter" };
export type NoDefaults<T extends SqlObj> = { [k in keyof T]?: DefaultVal };
export type DefaultVal = SqlPrimitive | (() => SqlPrimitive);
export type Defaults<ResourceTypeMap extends GenericTypeMap> = {
  [T in keyof ResourceTypeMap]: ResourceTypeMap[T]["defaults"];
};

// Helper for easily making filter types
export type Filter<T> = { _t: "filter" } & { [K in keyof T]: undefined | null | T[K] };

// Helpers for defaults
export const buffId = { id: () => hexToBuffer(uuid()) };
export const strId = { id: () => uuid() };
export const both = <A, B>(a: A, b: B) => ({ ...a, ...b });

/**
 * An interface without all the internal methods of the class
 */
export interface SqlInterface<ResourceTypeMap extends GenericTypeMap> {
  get<T extends keyof ResourceTypeMap>(
    t: T,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"]>>;
  get<T extends keyof ResourceTypeMap>(
    t: T,
    params: Api.CollectionParams | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"]>>;
  get<T extends keyof ResourceTypeMap>(
    t: T,
    filter: ResourceTypeMap[T]["filters"] | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"]>>;
  get<T extends keyof ResourceTypeMap>(
    t: T,
    filter: ResourceTypeMap[T]["filters"] | undefined | null,
    params: Api.CollectionParams | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"]>>;
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
}

/**
 * A very simple, not very powerful SQL Query object. Note that the keyword for each of these
 * sections will be provided, so the value for `limit`, for example, would be something like
 * `20,10`, rather than `LIMIT 20,10`.
 */
export type Query = {
  select: Array<string>;
  from: string;
  join?: undefined | null | Array<string>;
  where?: undefined | null | Array<string>;
  params?: undefined | null | Array<SqlValue>;
  limit?: undefined | null | string;
  sort?: undefined | null | Array<string>;
};

/**
 * This class abstracts all io access into generalized or specific declarative method calls
 */
export abstract class AbstractSql<ResourceTypeMap extends GenericTypeMap>
  implements SqlInterface<ResourceTypeMap> {
  protected db: SimpleSqlDbInterface;
  protected cache: CacheInterface;
  protected convertBuffersAndHex: boolean = true;

  /**
   * Define a map for types to table names. Any types that are not found in this map are assumed
   * to be synonymous with their tables.
   */
  protected tableMap: { [k in keyof ResourceTypeMap]?: string } = {};

  /**
   * Define default values for fields of various types
   */
  protected defaults: Defaults<ResourceTypeMap>;

  /**
   * Define wich fields are relationships for any given type. This determines how change set are
   * created and published.
   */
  protected resourceRelationships: {
    [k in keyof ResourceTypeMap]?: { [field: string]: string };
  } = {};

  /**
   * If any tables have alternate PKs, define them here (default is `id`)
   */
  protected primaryKeys: { [K in keyof ResourceTypeMap]?: keyof ResourceTypeMap[K]["type"] } = {};

  /**
   * Set the default page size
   */
  protected defaultPageSize = 25;

  /**
   * (Optional) Auditor client. This allows you to flow data changes into an auditing system.
   */
  protected audit: Audit.ClientInterface | null = null;

  /**
   * (Optional) Pubsub. This allows the service to publish friendlier "domain" messages about
   * data events. Note that this is largely the same data as the audit client, but the format
   * will be easier to use, and it additionally allows some separation between an auditing
   * system and a more generalized data environment.
   */
  protected pubsub: { publish(msg: unknown): Promise<unknown> } | null = null;

  /**
   * Get a resource
   *
   * This accommodates collections (optionally filtered and sorted) as well as single resources by
   * constraint.
   *
   * Filters and constraints are passed down to lower-level processing functions which can be
   * overridden in derivative classes.
   */
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"]>>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    params: Api.CollectionParams | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"]>>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    filter: ResourceTypeMap[T]["filters"] | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"]>>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    filter: ResourceTypeMap[T]["filters"] | undefined | null,
    params: Api.CollectionParams | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Api.CollectionResponse<ResourceTypeMap[T]["type"]>>;
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
      | Api.CollectionParams
      | ResourceTypeMap[T]["filters"]
      | ResourceTypeMap[T]["constraints"]
      | undefined
      | null,
    logOrParams?: SimpleLoggerInterface | Api.CollectionParams | undefined | null,
    logOrThrw?: boolean | undefined | SimpleLoggerInterface
  ): Promise<
    Api.CollectionResponse<ResourceTypeMap[T]["type"]> | ResourceTypeMap[T]["type"] | undefined
  > {
    const { log, thrw, collectionParams, constraint: _constraint, filter } = this.assignParams<T>([
      logParamsFilterConstraint,
      logOrParams,
      logOrThrw,
    ]);
    const table = <string>(this.tableMap[t] || this.sanitizeFieldName(t as string));
    const tableAlias = table.slice(0, 2);

    let query: Query = {
      select: [`\`${tableAlias}\`.*`],
      from: `\`${table}\` AS \`${tableAlias}\``,
    };

    if (filter || !_constraint) {
      log.debug(`Getting ${t} by filter '${JSON.stringify(filter)}'`);

      // Apply filter
      if (filter && Object.keys(filter).filter((k) => k !== "_t").length > 0) {
        // Turn the filters into a more complicated query
        for (const field in filter) {
          if (filter[field] !== undefined) {
            query = this.mergeQuery(query, this.getSqlForFilterField(t, field, filter[field]));
          }
        }
      }

      // Apply pagination and sort
      query = this.mergeQuery(query, this.processCollectionParams(t, collectionParams));

      // Compose query
      const { queryStr, params } = this.composeSql(query);

      // Now execute the query and return
      log.debug(`Final query: ${queryStr}; Params: ${JSON.stringify(params)}`);
      const { rows } = await this.db.query<ResourceTypeMap[T]["type"]>(queryStr, params);
      log.debug(`Returning ${rows.length} ${t}`);
      if (this.convertBuffersAndHex) {
        return rows.map((r) => this.buffersToHex(r));
      } else {
        return rows;
      }
    } else {
      const constraint = this.processConstraint(t, _constraint);

      // Validate
      if (constraint.where.length === 0) {
        throw new E.InternalServerError(
          `No constraints passed for resource '${t}'. Constraint: ${JSON.stringify(_constraint)}`
        );
      }

      log.debug(`Getting ${t} by ${JSON.stringify(constraint)} from database`);

      // If there's one or more undefined param, we can't use it
      if (constraint.params.filter((v) => v === undefined).length > 0) {
        log.info(`Constraint is incomplete. Cannot use. ${JSON.stringify(constraint)}`);
        if (thrw) {
          throw new E.NotFound(
            `No constraint value passed for ${t}, so the resource cannot be found.`
          );
        } else {
          return Promise.resolve(undefined);
        }
      }

      return this.cache.get<ResourceTypeMap[T]["type"]>(
        `${t}-${JSON.stringify(constraint)}`,
        async () => {
          // Compose query
          query = this.mergeQuery(query, <Partial<Query>>constraint);
          const { queryStr, params } = this.composeSql(query);

          // Execute
          log.debug(`Final query: ${queryStr}; Params: ${JSON.stringify(params)}`);
          const { rows } = await this.db.query<ResourceTypeMap[T]["type"]>(queryStr, params);

          if (thrw && rows.length === 0) {
            throw new E.NotFound(`${t} not found for the given parameters`);
          }

          // Warn if more than one found
          if (rows.length > 1) {
            log.warning(
              `More than one ${t} found when searching with constraint: Query: ${queryStr}; ` +
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
   * Default method. This should be overridden for domain-specific filters.
   */
  protected getSqlForFilterField<T extends keyof ResourceTypeMap>(
    t: T,
    field: string,
    val: any
  ): Partial<Query> {
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
    params: undefined | Api.CollectionParams
  ): Partial<Query> {
    const query: Partial<Query> = {};

    // Pagination
    const pg = params?.__pg;
    if (pg) {
      let num = 1;
      const size = pg.size || this.defaultPageSize;

      const _cursor = pg.cursor;
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

    // Sort
    const sort = params?.__sort?.trim();
    if (sort) {
      query.sort = this.parseSort(t, sort).map(
        (s) => `\`${this.sanitizeFieldName(s[0])}\` ${s[1]}`
      );
    }

    // Return
    return query;
  }

  /**
   * Parse a sort string
   *
   * This is a generic method that can be overridden by descendent classes to provide validation
   * for sort fields.
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
   * Compose a final query from the given query object
   */
  protected composeSql(q: Query): { queryStr: string; params: Array<SqlValue> | undefined } {
    return {
      queryStr:
        `SELECT ${q.select.join(", ")} ` +
        `FROM ${q.from}` +
        (q.join && q.join.length > 0 ? ` JOIN ${q.join.join(" JOIN ")}` : "") +
        (q.where && q.where.length > 0 ? ` WHERE ${q.where.join(" && ")}` : "") +
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

  public async update<T extends keyof ResourceTypeMap>(
    t: T,
    _resource: Partial<ResourceTypeMap[T]["type"]> & { id: string },
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<ResourceTypeMap[T]["type"]> {
    const pk = <keyof ResourceTypeMap[T]["type"]>(this.primaryKeys[t] || "id");
    const pkVal = _resource[pk];
    const pkValStr = Buffer.isBuffer(pkVal) ? pkVal.toString("hex") : `${pkVal}`;
    log.info(`Updating ${t} '${pkValStr}'`);

    const currentResource = await this.get(t, { [pk]: pkVal }, log, false);
    if (!currentResource) {
      throw new E.NotFound(
        `Resource of type '${t}', ${pk} '${pkValStr}', was not found.`,
        `RESOURCE-NOT-FOUND.${(t as string).toUpperCase()}`
      );
    }

    // Remove the id field, since we don't want accidental changes
    const resourceWithoutId = { ..._resource };
    delete resourceWithoutId[pk];

    const resource: ResourceTypeMap[T]["type"] = {
      ...currentResource,
      ..._resource,
    };

    return await this.save(t, resource, auth, log, currentResource);
  }

  public async save<T extends keyof ResourceTypeMap>(
    t: T,
    _resource: PartialSelect<ResourceTypeMap[T]["type"], keyof ResourceTypeMap[T]["defaults"]>,
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface,
    currentResource?: ResourceTypeMap[T]["type"]
  ): Promise<ResourceTypeMap[T]["type"]> {
    const pk = <keyof ResourceTypeMap[T]["type"]>(this.primaryKeys[t] || "id");
    log.info(`Saving resource '${t}${_resource[pk] ? `.${_resource[pk]}` : ""}`);

    if (!currentResource && _resource[pk]) {
      currentResource = await this.get(t, { t: pk, v: _resource[pk] }, log, false);
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
        "WHERE `" + pk + "` = ?";
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
    this.cache.clear(new RegExp(`${t}-.*`));

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
          resource: { type: t, ...resource },
        })
      );
    }

    await Promise.all(p);
    return resource;
  }

  public async delete<T extends keyof ResourceTypeMap>(
    t: T,
    resource: ResourceTypeMap[T]["type"],
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<void>;
  public async delete<T extends keyof ResourceTypeMap>(
    t: T,
    id: string | Buffer | undefined | null,
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<void>;
  public async delete<T extends keyof ResourceTypeMap>(
    t: T,
    resourceOrId: ResourceTypeMap[T]["type"] | string | Buffer | undefined | null,
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<void> {
    const pk = <keyof ResourceTypeMap[T]["type"]>(this.primaryKeys[t] || "id");
    let pkVal: Buffer | string | undefined | null = null;
    if (Buffer.isBuffer(resourceOrId) || typeof resourceOrId === "string") {
      pkVal = resourceOrId;
    } else if ((resourceOrId as any)[pk]) {
      pkVal = (resourceOrId as any)[pk];
    }
    const pkValStr = Buffer.isBuffer(pkVal) ? pkVal.toString("hex") : `${pkVal}`;
    log.debug(`Deleting ${t} with id ${pkValStr}`);
    const resource = this.get(t, { [pk]: pkVal }, log, false);
    if (resource) {
      const table = <string>(this.tableMap[t] || this.sanitizeFieldName(t as string));
      await this.db.query(
        "DELETE FROM `" + table + "` WHERE `" + pk + "` = ?",
        pkVal ? [pkVal] : []
      );
      log.debug(`Resource deleted publishing messages`);

      // Bust cache
      this.cache.clear(new RegExp(`${t}-.*`));

      // Publish audit message
      const p: Array<Promise<unknown>> = [];
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
          this.pubsub.publish({
            action: "deleted",
            resource: { type: t, ...resource },
          })
        );
      }

      await Promise.all(p);
    } else {
      log.info(`Resource not found. Nothing to delete.`);
    }
  }

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

  protected mergeQuery(base: Query, add: Partial<Query>): Query {
    const result: Query = {
      select: [...base.select, ...(add.select || [])],
      from: add.from || base.from,
    };
    if (base.join || add.join) {
      result.join = [...(base.join || []), ...(add.join || [])];
    }
    if (base.where || add.where) {
      result.where = [...(base.where || []), ...(add.where || [])];
    }
    if (base.params || add.params) {
      result.params = [...(base.params || []), ...(add.params || [])];
    }
    if (add.limit || base.limit) {
      result.limit = add.limit || base.limit;
    }
    if (base.sort || add.sort) {
      result.sort = [...(base.sort || []), ...(add.sort || [])];
    }
    return result;
  }

  protected assignParams<T extends keyof ResourceTypeMap>(
    opts: [
      (
        | SimpleLoggerInterface
        | Api.CollectionParams
        | ResourceTypeMap[T]["filters"]
        | ResourceTypeMap[T]["constraints"]
        | undefined
        | null
      ),
      SimpleLoggerInterface | Api.CollectionParams | undefined | null,
      SimpleLoggerInterface | boolean | undefined
    ]
  ): {
    log: SimpleLoggerInterface;
    thrw: boolean;
    collectionParams: Api.CollectionParams | undefined;
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
          | Api.CollectionParams
          | undefined
          | null
        ),
        Api.CollectionParams | boolean | undefined | null
      ]
    >(logIndex === 0
      ? [opts[1], opts[2]]
      : logIndex === 1
      ? [opts[0], opts[2]]
      : [opts[0], opts[1]]);

    const thrw = typeof others[1] === "boolean" ? others[1] : false;

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

    const filter = others[0];
    if (this.isFilter<T>(filter)) {
      return {
        log,
        thrw,
        filter,
        collectionParams: <Api.CollectionParams | undefined>(others[1] || undefined),
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
   * This function finds all buffers and converts them to hex. If the "uuids" param is true or
   * undefined and the buffer is 16 bytes, the resulting string is formatted as a uuid.
   *
   * NOTE: Typescript makes it almost impossible to do things like this, so we're going to disable it
   * for this function
   */
  protected buffersToHex<T, Except extends keyof T | undefined>(
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
   * Unfortunately, there's no way to easily figure out _which_ keys will be converted, since we're
   * doing some actual string analysis here. Need to come back to this.
   * TODO: Create better typing parameters for hexToBuffers
   *
   * NOTE: Typescript makes it almost impossible to do things like this, so we're going to disable it
   * for this function
   */
  protected hexToBuffers<T extends { [k: string]: unknown }, Converted extends keyof T | undefined>(
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

  public bufferToUuid(buf: Buffer): string {
    return bufferToUuid(buf);
  }

  public hexToBuffer(hex: string): Buffer {
    return hexToBuffer(hex);
  }
}

const bufferToUuid = (buf: Buffer): string => {
  return `${bite(buf, 0, 4)}-${bite(buf, 4, 6)}-${bite(buf, 6, 8)}-${bite(buf, 8, 10)}-${bite(
    buf,
    10
  )}`;
};

const hexToBuffer = (hex: string): Buffer => {
  return Buffer.from(hex.replace(/-/g, ""), "hex");
};

const isLog = (thing: any): thing is SimpleLoggerInterface => {
  return thing && thing.debug && thing.info && thing.notice && thing.error;
};
const isCollectionParams = (thing: any): thing is Api.CollectionParams => {
  return thing && (thing.__pg || thing.__sort);
};

const sortDir: { [k: string]: "ASC" | "DESC" } = {
  "": "ASC",
  "+": "ASC",
  "-": "DESC",
};

const bite = (buf: Buffer, i: number, j?: number): string => buf.slice(i, j).toString("hex");
