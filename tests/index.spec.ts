import * as E from "@openfinanceio/http-errors";
import { MockSimpleLogger } from "@wymp/ts-simple-interfaces-testing";
import { AbstractSql } from "../src";
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
  ): { clauses: Array<string>; params: Array<any> } | undefined {
    // User filters
    if (t === "users") {
      // Pet filters
      if (field === "pet") {
        const clauses: Array<string> = ["`ownerId` = `users`.`id`"];
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
          clauses: ["EXISTS (SELECT * FROM `pets` WHERE " + clauses.join(" && ") + ")"],
          params,
        };
      }

      if (field === "emailLike") {
        return {
          clauses: ["`email` LIKE ?"],
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
        query: "SELECT * FROM `users` WHERE `id` = ?",
        params: ["abcde"],
      });
      expect(q[1]).toMatchObject({
        query: "SELECT * FROM `users` WHERE `email` = ?",
        params: ["12345"],
      });
      expect(q[2]).toMatchObject({
        query: "SELECT * FROM `users` WHERE `primaryAddressId` = ?",
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
        io.get("users", { _t: "filter", pet: { type: "dog" } }, log),
        io.get("users", { _t: "filter", pet: { type: "dog", nameLike: "bowser%" } }, log),
        io.get("users", { _t: "filter", emailLike: "%jimmy%" }, log),
        io.get("users", { _t: "filter" }, log),
      ]);

      const q = io.mockDb.queries;
      expect(q).toHaveLength(4);
      expect(q[0]).toMatchObject({
        query:
          "SELECT * FROM `users` WHERE EXISTS (SELECT * FROM `pets` WHERE `ownerId` = `users`.`id` && `type` = ?) LIMIT 0, 25",
        params: ["dog"],
      });
      expect(q[1]).toMatchObject({
        query:
          "SELECT * FROM `users` WHERE EXISTS (SELECT * FROM `pets` WHERE `ownerId` = `users`.`id` && `type` = ? && `pets`.`name` LIKE ?) LIMIT 0, 25",
        params: ["dog", "bowser%"],
      });
      expect(q[2]).toMatchObject({
        query: "SELECT * FROM `users` WHERE `email` LIKE ? LIMIT 0, 25",
        params: ["%jimmy%"],
      });

      // Uncomment to test typings

      //await io.get("users", { _t: "filter", id: "abcde", email: "12345" }, log);
    });
  });
});
