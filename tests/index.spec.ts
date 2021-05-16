import * as E from "@openfinanceio/http-errors";
import { MockSimpleLogger } from "@wymp/ts-simple-interfaces-testing";
import { AbstractSql, Query } from "../src";
import { MockSql } from "./MockSql";
import { Test } from "./Types";

// Create a full class from the base
class TestIo extends AbstractSql<Test.TypeMap> {
  public readonly mockDb: MockSql;

  constructor() {
    super();
    this.mockDb = new MockSql();
    this.db = this.mockDb;
    this.cache = {
      get(k: string, f: () => any): any {
        return f();
      },
      clear(k?: any) {},
    };

    this.tableMap = { "org-roles": "organization-roles" };
    this.defaults = {
      users: Test.UserDefaults,
      addresses: Test.AddressDefaults,
      organizations: Test.OrganizationDefaults,
    };
  }

  protected getSqlForFilterField<T extends keyof Test.TypeMap>(
    t: T,
    field: string,
    val: any
  ): Partial<Query> {
    // User filters
    if (t === "users") {
      // Pet filters
      if (field === "pet") {
        const clauses: Array<string> = ["`ownerId` = `us`.`id`"];
        const params: Array<any> = [];
        if (val.type !== undefined) {
          clauses.push("`type` = ?");
          params.push(val.type);
        }
        if (val.nameLike) {
          clauses.push("`pets`.`name` LIKE ?");
          params.push(val.nameLike);
        }
        return {
          where: ["EXISTS (SELECT * FROM `pets` AS `pe` WHERE " + clauses.join(" && ") + ")"],
          params,
        };
      }

      if (field === "emailLike") {
        return {
          where: ["`email` LIKE ?"],
          params: [val],
        };
      }
    }

    return super.getSqlForFilterField(t, field, val);
  }
}

describe("BaseSql Class", () => {
  let io: TestIo;
  let log: MockSimpleLogger;

  beforeEach(() => {
    log = new MockSimpleLogger();
    io = new TestIo();
  });

  describe("get", () => {
    test("can get user with constraints", async () => {
      let e: E.HttpError | null = null;
      await Promise.all([
        io.get("users", { id: "abcde" }, log),
        io.get("users", { email: "12345" }, log),
        io.get("users", { primaryAddressId: "00000" }, log),

        io.get("users", { id: "abcde" }, log, true).catch((err) => (e = err)),
      ]);

      const q = io.mockDb.queries;
      expect(q).toHaveLength(4);
      expect(q[0]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` WHERE `id` = ?",
        params: ["abcde"],
      });
      expect(q[1]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` WHERE `email` = ?",
        params: ["12345"],
      });
      expect(q[2]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` WHERE `primaryAddressId` = ?",
        params: ["00000"],
      });

      expect(e).not.toBe(null);
      expect(e!.status).toBe(404);

      // Uncomment to test typings

      // NOTE: Currently this _should_ fail validation but it doesn't. Appears to be an error in
      // typescript.
      //await io.get("users", { id: "abcde", email: "12345" }, log);
    });

    test("can get user with filter", async () => {
      await Promise.all([
        // Simple
        io.get("users", { _t: "filter", pet: { type: "dog" } }, undefined, log),
        io.get(
          "users",
          { _t: "filter", pet: { type: "dog", nameLike: "bowser%" } },
          undefined,
          log
        ),
        io.get("users", { _t: "filter", emailLike: "%jimmy%" }, undefined, log),
        io.get("users", { _t: "filter" }, log),
        io.get("users", log),

        // With collection params
        io.get(
          "users",
          { _t: "filter", pet: { type: "dog", nameLike: "bowser%" } },
          {
            __pg: { size: 100, cursor: Buffer.from("num:3").toString("base64") },
          },
          log
        ),
        io.get(
          "users",
          { _t: "filter", pet: { type: "dog", nameLike: "bowser%" } },
          {
            __pg: { size: 100 },
            __sort: "name",
          },
          log
        ),
        io.get(
          "users",
          { _t: "filter", pet: { type: "dog" } },
          {
            __pg: { cursor: Buffer.from("num:3").toString("base64") },
            __sort: "name",
          },
          log
        ),
        io.get(
          "users",
          { _t: "filter", pet: { type: "dog" } },
          {
            __sort: "-name",
          },
          log
        ),
        io.get(
          "users",
          { _t: "filter", pet: { type: "dog" } },
          {
            __sort: "-name,+type",
          },
          log
        ),
        io.get(
          "users",
          { _t: "filter", pet: { type: "dog" } },
          {
            __sort: "-name,type",
          },
          log
        ),
        io.get("users", { __sort: "-name,type" }, log),
      ]);

      const q = io.mockDb.queries;
      expect(q).toHaveLength(12);
      expect(q[0]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ?) LIMIT 0, 25",
        params: ["dog"],
      });
      expect(q[1]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ? && `pets`.`name` LIKE ?) LIMIT 0, 25",
        params: ["dog", "bowser%"],
      });
      expect(q[2]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` WHERE `email` LIKE ? LIMIT 0, 25",
        params: ["%jimmy%"],
      });
      expect(q[3]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` LIMIT 0, 25",
        params: undefined,
      });
      expect(q[4]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` LIMIT 0, 25",
        params: undefined,
      });

      expect(q[5]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ? && `pets`.`name` LIKE ?) LIMIT 200, 100",
        params: ["dog", "bowser%"],
      });
      expect(q[6]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ? && `pets`.`name` LIKE ?) ORDER BY `name` ASC LIMIT 0, 100",
        params: ["dog", "bowser%"],
      });
      expect(q[7]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ?) ORDER BY `name` ASC LIMIT 50, 25",
        params: ["dog"],
      });
      expect(q[8]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ?) ORDER BY `name` DESC LIMIT 0, 25",
        params: ["dog"],
      });
      expect(q[9]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ?) ORDER BY `name` DESC, `type` ASC LIMIT 0, 25",
        params: ["dog"],
      });
      expect(q[10]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ?) ORDER BY `name` DESC, `type` ASC LIMIT 0, 25",
        params: ["dog"],
      });
      expect(q[11]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` ORDER BY `name` DESC, `type` ASC LIMIT 0, 25",
        params: undefined,
      });

      // Uncomment to test typings

      //await io.get("users", { _t: "filter", id: "abcde", email: "12345" }, undefined, log);
    });
  });
});
