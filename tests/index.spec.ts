import * as E from "@wymp/http-errors";
import { MockSimpleLogger } from "@wymp/ts-simple-interfaces-testing";
import { Auth } from "@wymp/types";
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
    this.defaults = Test.Defaults;
  }

  public testHexToBuffers<
    T extends { [k: string]: unknown },
    Converted extends keyof T | undefined
  >(
    _obj: T
  ): Converted extends undefined ? T : { [K in keyof T]: K extends Converted ? Buffer : T[K] } {
    return this.hexToBuffers<T, Converted>(_obj);
  }

  public testBuffersToHex<T, Except extends keyof T | undefined>(
    _obj: T,
    params?: {
      notUuid?: true | Array<keyof T>;
      not?: Array<Except>;
    }
  ): { [K in keyof T]: T[K] extends Buffer ? (K extends Except ? Buffer : string) : T[K] } {
    return this.buffersToHex<T, Except>(_obj, params);
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

describe("AbstractSql Class", () => {
  let io: TestIo;
  let log: MockSimpleLogger;
  let fakeAuth: Auth.ReqInfo = <any>{};

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
        query: "SELECT `us`.* FROM `users` AS `us` WHERE (`id` = ?)",
        params: ["abcde"],
      });
      expect(q[1]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` WHERE (`email` = ?)",
        params: ["12345"],
      });
      expect(q[2]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` WHERE (`primaryAddressId` = ?)",
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
          "SELECT `us`.* FROM `users` AS `us` WHERE (EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ?)) LIMIT 0, 25",
        params: ["dog"],
      });
      expect(q[1]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE (EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ? && `pets`.`name` LIKE ?)) LIMIT 0, 25",
        params: ["dog", "bowser%"],
      });
      expect(q[2]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` WHERE (`email` LIKE ?) LIMIT 0, 25",
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
          "SELECT `us`.* FROM `users` AS `us` WHERE (EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ? && `pets`.`name` LIKE ?)) LIMIT 200, 100",
        params: ["dog", "bowser%"],
      });
      expect(q[6]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE (EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ? && `pets`.`name` LIKE ?)) ORDER BY `name` ASC LIMIT 0, 100",
        params: ["dog", "bowser%"],
      });
      expect(q[7]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE (EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ?)) ORDER BY `name` ASC LIMIT 50, 25",
        params: ["dog"],
      });
      expect(q[8]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE (EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ?)) ORDER BY `name` DESC LIMIT 0, 25",
        params: ["dog"],
      });
      expect(q[9]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE (EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ?)) ORDER BY `name` DESC, `type` ASC LIMIT 0, 25",
        params: ["dog"],
      });
      expect(q[10]).toMatchObject({
        query:
          "SELECT `us`.* FROM `users` AS `us` WHERE (EXISTS (SELECT * FROM `pets` AS `pe` WHERE `ownerId` = `us`.`id` && `type` = ?)) ORDER BY `name` DESC, `type` ASC LIMIT 0, 25",
        params: ["dog"],
      });
      expect(q[11]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` ORDER BY `name` DESC, `type` ASC LIMIT 0, 25",
        params: undefined,
      });

      // Uncomment to test typings

      //await io.get("users", { _t: "filter", id: "abcde", email: "12345" }, undefined, log);
    });

    test("can get users with buffer constraint", async () => {
      await io.get("users", { id: io.hexToBuffer("aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000") }, log);

      const q = io.mockDb.queries;
      expect(q).toHaveLength(1);
      expect(q[0]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` WHERE (`id` = ?)",
      });
      expect(Buffer.isBuffer(q[0].params![0])).toBe(true);
    });
  });

  describe("save", () => {
    test("works", async () => {
      const user = await io.save(
        "users",
        { name: "Milli Vanilli", email: "test@example.com" },
        fakeAuth,
        log
      );
      expect(user).toMatchObject({
        id: expect.any(String),
        name: "Milli Vanilli",
        email: "test@example.com",
        dob: Test.Defaults["users"].dob,
        deleted: Test.Defaults["users"].deleted,
        verified: Test.Defaults["users"].verified,
        primaryAddressId: Test.Defaults["users"].primaryAddressId,
        status: Test.Defaults["users"].status,
        createdMs: expect.any(Number),
      });
    });
  });

  describe("delete", () => {
    const user = {
      id: "abcde",
      name: "Milli Vanilli",
      email: "test@example.com",
      dob: Test.Defaults["users"].dob,
      deleted: Test.Defaults["users"].deleted,
      verified: Test.Defaults["users"].verified,
      primaryAddressId: Test.Defaults["users"].primaryAddressId,
      status: Test.Defaults["users"].status,
      createdMs: Date.now(),
    };

    test("can delete user with constraint", async () => {
      io.mockDb.setNextResult([user]);
      await io.delete("users", { id: "abcde" }, fakeAuth, log);

      const q = io.mockDb.queries;
      expect(q).toHaveLength(2);
      expect(q[0]).toMatchObject({
        query: "SELECT `us`.* FROM `users` AS `us` WHERE (`id` = ?)",
        params: ["abcde"],
      });
      expect(q[1]).toMatchObject({
        query: "DELETE FROM `users` WHERE (`id` = ?) LIMIT 1000",
        params: ["abcde"],
      });

      // Uncomment to test typings

      // NOTE: Currently this _should_ fail validation but it doesn't. Appears to be an error in
      // typescript.
      // await io.delete("users", { id: "abcde", email: "12345" }, fakeAuth, log);
    });

    test("can delete user with filter", async () => {
      const res1: Array<Test.User> = [];
      for (let i = 0; i < 1000; i++) {
        res1.push(user);
      }
      // Select 1
      io.mockDb.setNextResult(res1);
      // Delete 1
      io.mockDb.setNextResult([]);
      // Select 2
      io.mockDb.setNextResult([user]);
      // Delete 2
      io.mockDb.setNextResult([]);
      // Go
      await io.delete("users", { _t: "filter", emailLike: "abcde" }, fakeAuth, log);

      const q = io.mockDb.queries;
      expect(q).toHaveLength(4);

      const select = {
        query: "SELECT `us`.* FROM `users` AS `us` WHERE (`email` LIKE ?) LIMIT 0, 1000",
        params: ["abcde"],
      };
      const del = {
        query: "DELETE FROM `users` WHERE (`email` LIKE ?) LIMIT 1000",
        params: ["abcde"],
      };

      expect(q[0]).toMatchObject(select);
      expect(q[1]).toMatchObject(del);
      expect(q[2]).toMatchObject(select);
      expect(q[3]).toMatchObject(del);

      // Uncomment to test typings
      //await io.delete("users", { _t: "filter", bimchow: "12345" }, fakeAuth, log);
    });
  });

  describe("hexToBuffers", () => {
    const obj = {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000",
      hex: "aaaaaaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999",
      a: "a",
      b: "b",
      one: 1,
      two: 2,
      t: true,
      f: false,
    };

    test("converts id fields to buffers", () => {
      const newObj = io.testHexToBuffers<typeof obj, "id" | "hex">(obj);
      expect(Buffer.isBuffer(newObj.id)).toBe(true);
      expect(Buffer.isBuffer(newObj.hex)).toBe(true);
      expect(Buffer.isBuffer(obj.id)).toBe(false);
      expect(Buffer.isBuffer(obj.hex)).toBe(false);
      expect(newObj.id.toString("hex")).toBe(obj.id.replace(/-/g, ""));
      expect(newObj.hex.toString("hex")).toBe(obj.hex);
    });
  });

  describe("buffersToHex", () => {
    const obj = {
      id: Buffer.from("aaaaaaaabbbbccccddddeeeeffff0000", "hex"),
      hex: Buffer.from(
        "aaaaaaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999",
        "hex"
      ),
      a: "a",
      b: "b",
      one: 1,
      two: 2,
      t: true,
      f: false,
    };

    test("converts buffer fields to hex", () => {
      const newObj = io.testBuffersToHex(obj);
      expect(typeof newObj.id).toBe("string");
      expect(typeof newObj.hex).toBe("string");
      expect(Buffer.isBuffer(obj.id)).toBe(true);
      expect(Buffer.isBuffer(obj.hex)).toBe(true);
      expect(newObj.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000");
      expect(newObj.hex).toBe(
        "aaaaaaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999"
      );
    });

    test("does not convert excepted fields", () => {
      const newObj = io.testBuffersToHex(obj, { not: ["hex", "id"] });
      expect(Buffer.isBuffer(newObj.id)).toBe(true);
      expect(Buffer.isBuffer(newObj.hex)).toBe(true);
      expect(newObj.id.toString("hex")).toBe("aaaaaaaabbbbccccddddeeeeffff0000");
      expect(newObj.hex.toString("hex")).toBe(
        "aaaaaaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999"
      );
    });

    test("does not convert indicated fields to uuid", () => {
      const newObj = io.testBuffersToHex(obj, { notUuid: ["id"] });
      expect(typeof newObj.id).toBe("string");
      expect(typeof newObj.hex).toBe("string");
      expect(newObj.id).toBe("aaaaaaaabbbbccccddddeeeeffff0000");
    });

    test("does not convert any fields to uuid when requested", () => {
      const newObj = io.testBuffersToHex(obj, { notUuid: true });
      expect(typeof newObj.id).toBe("string");
      expect(typeof newObj.hex).toBe("string");
      expect(newObj.id).toBe("aaaaaaaabbbbccccddddeeeeffff0000");
    });
  });
});
