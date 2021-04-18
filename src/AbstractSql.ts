//import { v6 as uuid } from "uuid-with-v6";
import {
  SimpleSqlDbInterface,
  SqlValue,
  SqlPrimitive,
  SimpleLoggerInterface,
} from "@wymp/ts-simple-interfaces";
import * as E from "@openfinanceio/http-errors";
//import { Audit, Auth, PartialSelect } from "@wymp/types";

export interface CacheInterface {
  get<T>(k: string, cb: () => Promise<T>, ttl?: number, log?: SimpleLoggerInterface): Promise<T>;
  get<T>(k: string, cb: () => T, ttl?: number, log?: SimpleLoggerInterface): T;
  clear(k: string | RegExp): void | unknown;
}

/**
 * This is a type that you would define within your own domain. It specifies a string type
 * identifier (`t`), together with the database type for that object. The string type identifier
 * should match the `type` parameter of the API type for the same object.
 *
 * In your domain, this would look something like the following:
 *
 * export type TypeMap =
 *   | { t: "users"; v: MyDomain.Db.User; }
 *   | { t: "events"; v: MyDomain.Db.Event; }
 *   ....
 */
export type GenericTypeMap = {
  [t: string]: {
    type: unknown;
    constraint: { [k: string]: SqlPrimitive | undefined };
    filter: NullFilter;
    defaults: NoDefaults;
  };
};

export type IdConstraint = { id: string | undefined | null };
export type NullFilter = { _t: "filter" };
export type NoDefaults = { [k in keyof {}]?: SqlPrimitive | (() => SqlPrimitive) };

/**
 * This defines filter types that can be used for the resource types specified in your TypeMap.
 *
 * For your domain, the `filter` parameter can be literally anything you would like to accept and
 * parse. For example, you might accept several fields on which to filter users, as well as one
 * field on which to filter events:
 *
 * export type ResourceFilter = 
 *    | {
 *      t: "users";
 *      filter: {
 *        name?: string;
 *        email?: string;
 *        ageGreaterThan?: number;
 *      };
 *    }
 *    | {
 *      t: "events";
 *      filter: {
 *        startTimestampLt?: number;
 *        startTimestampGt?: number;
 *      }
 *    }
 *
export type GenericFilter = {
  t: string;
  filter: unknown;
};

/**
 * This defines applicable constraints for finding individual resources. The most common one would
 * be, e.g., { t: string, by: { id: string } }
 *
 * You will define all of the possible options for your domain, probably including a default option
 * allowing you to access all resources by id. This might look like the following:
 *
 * export type MyResourceConstraints =
 *   | {
 *     t: "users";
 *     by:
 *       | { id: string | undefined | null }
 *       | { email: string | undefined | null }
 *   }
 *   | {
 *     t: Exclude<TypeMap["t"], "users">;
 *     by: {id: string | undefined | null };
 *   }
 *
 *
export type ResourceConstraintType = {
  t: string;
  by: { [k: string]: string | number | undefined | null;
};
*/

/**
 * This class abstracts all io access into generalized or specific declarative method calls
 */
export abstract class AbstractSql<ResourceTypeMap extends GenericTypeMap> {
  protected db: SimpleSqlDbInterface;
  protected cache: CacheInterface;

  /**
   * Define a map for types to table names. Any types that are not found in this map are assumed
   * to be synonymous with their tables.
   */
  protected tableMap: { [k in keyof ResourceTypeMap]?: string } = {};

  /**
   * Define default values for fields of various types
   */
  protected defaults: {
    [T in keyof ResourceTypeMap]?: {
      [F in keyof ResourceTypeMap[T]["type"]]?:
        | ResourceTypeMap[T]["type"][F]
        | (() => ResourceTypeMap[T]["type"][F]);
    };
  } = {};

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
    filter: ResourceTypeMap[T]["filter"] | undefined | null,
    log: SimpleLoggerInterface
  ): Promise<Array<ResourceTypeMap[T]["type"]>>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    constraint: ResourceTypeMap[T]["constraint"],
    log: SimpleLoggerInterface,
    thrw: true
  ): Promise<ResourceTypeMap[T]["type"]>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    constraint: ResourceTypeMap[T]["constraint"],
    log: SimpleLoggerInterface,
    thrw?: false
  ): Promise<ResourceTypeMap[T]["type"] | undefined>;
  public async get<T extends keyof ResourceTypeMap>(
    t: T,
    constraintOrFilter:
      | ResourceTypeMap[T]["filter"]
      | ResourceTypeMap[T]["constraint"]
      | undefined
      | null,
    log: SimpleLoggerInterface,
    thrw?: boolean
  ): Promise<Array<ResourceTypeMap[T]["type"]> | ResourceTypeMap[T]["type"] | undefined> {
    const table = this.tableMap[t] || this.sanitizeFieldName(t as string);

    if (!constraintOrFilter || this.isFilter<T>(constraintOrFilter)) {
      const filter = constraintOrFilter;
      log.debug(`Getting ${t} by filter '${JSON.stringify(filter)}'`);

      const clauses: Array<string> = [];
      const params: Array<SqlValue> = [];

      if (!filter) {
        log.debug(`No filter passed - applying default pagination and getting all ${t}`);
      } else {
        // Otherwise, turn the filters into a more complicated query
        for (const field in filter) {
          const val = filter[field];
          if (val === undefined) {
            continue;
          }

          const results = this.getSqlForFilterField(t, field, val);
          if (results !== undefined) {
            log.debug(`Filter clauses returned for field ${t}.${field}.`);
            clauses.push(...results.clauses);
            params.push(...results.params);
          } else {
            log.debug(`No filter clauses returned for field ${t}.${field}`);
          }
        }
      }

      // Apply pagination and sort
      // TODO: Figure out how to incorporate this
      const { limit } = this.constructPagination(t, clauses, params, undefined);
      const { orderBy } = this.constructSort(t, clauses, params, undefined);

      // Now execute the query and return
      const query =
        "SELECT * FROM `" +
        table +
        "`" +
        (clauses.length > 0 ? ` WHERE ${clauses.join(" && ")}` : "") +
        (orderBy ? ` ${orderBy}` : "") +
        (limit ? ` ${limit}` : "");
      log.debug(`Final query: ${query}; Params: ${JSON.stringify(params)}`);

      const { rows } = await this.db.query<ResourceTypeMap[T]["type"]>(query, params);

      log.debug(`Returning ${rows.length} ${t}`);
      return rows;
    } else {
      const by = constraintOrFilter;
      const field = Object.keys(by)[0];
      const val = by[field];

      // Validate
      if (!field) {
        throw new E.InternalServerError(
          `No field passed as constraint for resource '${t}'. Constraint: ${JSON.stringify(by)}`
        );
      }
      if (Object.keys(by).length > 1) {
        throw new E.InternalServerError(
          `You may only apply a single field as a constraint when querying '${t}'. Constraint ` +
            `passed: ${JSON.stringify(by)}`
        );
      }

      log.debug(`Getting ${t} by ${field}:${val} from database`);

      if (!val) {
        if (thrw) {
          throw new E.NotFound(
            `No constraint value passed for ${t}, so the resource cannot be found.`
          );
        } else {
          return Promise.resolve(undefined);
        }
      }

      return this.cache.get<ResourceTypeMap[T]["type"]>(
        `${t}-${field}:${val}`,
        async () => {
          const query =
            "SELECT * FROM `" + table + "` WHERE `" + this.sanitizeFieldName(field) + "` = ?";
          const { rows } = await this.db.query<T>(query, [val]);
          if (thrw && rows.length === 0) {
            throw new E.NotFound(`${t} ${field}:${val} not found`);
          }

          // Warn if more than one found
          if (rows.length > 1) {
            log.warning(
              `More than one ${t} found when searching by ${field}:${val}. Query: ${query}; ` +
                `Params: ${JSON.stringify([val])}`
            );
          }

          return rows[0];
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
  ): { clauses: Array<string>; params: Array<any> } | undefined {
    // Ignore the special '_t' tag
    if (field === "_t") {
      return undefined;
    }

    // Sanitize field (shouldn't be necessary, but high-stakes, so we're doing it)
    field = this.sanitizeFieldName(field);
    if (Array.isArray(val)) {
      // If we're dealing with an array, use a set
      return {
        clauses: ["`" + field + "` IN (?)"],
        params: [val],
      };
    } else {
      // Otherwise, use an equals
      return {
        clauses: ["`" + field + "` = ?"],
        params: [val],
      };
    }
  }

  /**
   * Apply pagination parameters to existing clauses/params
   * TODO: Figure out how to do this
   */
  protected constructPagination<T extends keyof ResourceTypeMap>(
    t: T,
    clauses: Array<string>,
    params: Array<SqlValue>,
    pg: undefined | null | { size?: number; num: number }
  ): { limit: string } {
    const size = pg?.size || 25;
    const num = pg?.num || 1;
    return { limit: `LIMIT ${(num - 1) * size}, ${size}` };
  }

  /**
   * Construct sort parameters
   * TODO: Figure out how to do this
   */
  protected constructSort<T extends keyof ResourceTypeMap>(
    t: T,
    clauses: Array<string>,
    params: Array<SqlValue>,
    sort: undefined | null | Array<[field: string, dir: "asc" | "desc"]>
  ): { orderBy: string } {
    if (!sort || sort.length === 0) {
      return { orderBy: "" };
    } else {
      return { orderBy: ` ORDER BY ${sort.map((s) => "`" + s[0] + "` " + s[1]).join(", ")}` };
    }
  }

  protected sanitizeFieldName(field: string): string {
    return field.replace(/[`'"]+|--+/g, "");
  }

  protected isFilter<T extends keyof ResourceTypeMap>(f: any): f is ResourceTypeMap[T]["filter"] {
    return f._t === "filter";
  }

  /*
  public async update<T extends keyof ResourceTypeMap>(
    t: T,
    _resource: Partial<ResourceTypemap[T]["type"]> & { id: string },
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface
  ): Promise<ResourceTypeMap[T]["type"]> {
    log.info(`Updating ${t} '${_resource.id}'`);

    const currentResource = await this.get<ResourceTypeMap[T]["type"]>(
      t,
      { id: _resource.id },
      log,
      false
    );
    if (!currentResource) {
      throw new E.NotFound(
        `Resource of type '${t}', id '${_resource.id}', was not found.`,
        `RESOURCE-NOT-FOUND.${t.toUpperCase()}`
      );
    }

    // Remove the id field, since we don't want accidental changes
    const resourceWithouId = { ..._resource };
    delete resourceWithoutId.id;

    const resource: ResourceTypeMap[T]["type"] = {
      ...currentResource,
      ..._resource,
    };

    return await this.save<ResourceTypeMap[T]["type"]>(t, resource, auth, log, currentResource);
  }

  public async save<T extends keyof ResourceTypeMap>(
    t: T,
    _resource: PartialSelect<ResourceTypeMap[T]["type"], "id" | keyof typeof this.defaults[T]>,
    auth: Auth.ReqInfo,
    log: SimpleLoggerInterface,
    currentResource?: ResourceTypeMap[T]["type"]
  ): Promise<ResourceTypeMap[T]["type"]> {
    log.info(`Saving resource '${t}${_resource.id ? `.${_resource.id}` : ""}`);

    if (!currentResource && _resource.id) {
      currentResource = await this.get<ResourceTypeMap[T]["type"]>({ t, by: { t: "id", v: _resource.id } }, log, false);
    }

    let resource: ResourceTypeMap[T]["type"];

    // If this is a new resource, fill in defaults
    if (!currentResource) {
      const defaults: { [K in keyof (typeof this.defaults)[T]]: ResourceTypeMap[T]["type"][K] } =
        Object.keys(this.defaults[t] || {}).map((k) => {
          return {
            [k]: typeof this.defaults[t][k] === "function"
              ? this.defaults[t][k]()
              : this.defaults[t][k];
          }
        }).reduce((agg, cur) => { ...agg, ...cur }, {});
      resource = {
        id: _resource.id || uuid(),
        ...defaults,
        ..._resource,
      }
    } else {
      // Otherwise, fill the resource in with the existing resource
      resource = {
        ...currentResource,
        ..._resource,
      }
    };

    // Aggregate and format changes
    const changes: Audit.Changes<ResourceTypeMap[T]["type"]> = {};
    for (const k of <Array<keyof ResourceTypeMap[T]["type"]>>Object.keys(resource)) {
      // If it's not pertinent or it hasn't changed, skip
      if (k === "id" || (currentResource && resource[k] === currentResource[k])) {
        continue;
      }

      const v = resource[k];

      // Rels
      if (ResourceRelationships[t].includes(k)) {
        changes[k] = {
          t: "rel",
          action:
            !currentResource || (currentResource[k] === null && v !== null)
              ? "added"
              : currentResource && currentResource[k] !== null && v === null
              ? "deleted"
              : "changed",
          relType: "issuers",
          relId: <string>v,
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
    const table = this.tableMap[t] || this.sanitizeFieldName(t);
    if (currentResource) {
      // prettier-ignore
      const query = "UPDATE `" + table + "` " +
        `SET ${Object.keys(changes).map(k => `\`${k}\` = ?`).join(", ")} ` +
        "WHERE id = ?";
      const params = [
        ...Object.values(changes).map((v) => {
          if (v.t === "attr") {
            return v.next;
          } else {
            return v.action === "deleted" ? null : v.relId;
          }
        }),
        resource.id,
      ];
      await this.db.query(query, params);
    } else {
      // prettier-ignore
      const query = "INSERT INTO `" + table + "` " +
        "(`id`, `" + Object.keys(changes).join("`, `") + "`) VALUES (?)";
      const params = [
        [
          resource.id,
          ...Object.values(changes).map((v) => {
            if (v.t === "attr") {
              return v.next;
            } else {
              return v.action === "deleted" ? null : v.relId;
            }
          }),
        ],
      ];
      //console.log(query, params);
      await this.db.query(query, params);
    }

    // Bust cache
    this.cache.clear(new RegExp(`${t}-.*`));

    // Publish audit message
    log.debug(`Publishing audit message`);
    if (currentResource) {
      this.audit.update<ResourceTypeMap[T]["type"]>({
        auth,
        targetType: t,
        targetId: resource.id,
        changes,
      });
    } else {
      this.audit.create({
        auth,
        targetType: t,
        targetId: resource.id,
      });
    }

    // Publish domain message
    log.debug(`Publishing domain message`);
    if (currentResource) {
      await this.pubsub.publish(<Globals.Messages.SubmittedUpdate<ResourceTypeMap[T]["type"]>>{
        action: "updated",
        resource: { type: t, id: currentResource.id },
        changedFields: Object.entries(changes)
          // Regretably, there's no easy way to avoid an any cast here....
          .reduce<any>((agg, [k, v]) => {
            agg[k] = v.t === "attr" ? v.next : v.relId;
            return agg;
          }, {}),
      });
    } else {
      await this.pubsub.publish({
        action: "created",
        resource: { type: t, ...resource },
      });
    }

    return resource;
  }
  */
}
