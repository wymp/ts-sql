import {
  SimpleSqlDbInterface,
  SimpleSqlResponseInterface,
  SqlValue,
} from "@wymp/ts-simple-interfaces";

export class MockSql implements SimpleSqlDbInterface {
  public readonly queries: Array<{
    query: string;
    params: null | undefined | Array<SqlValue>;
  }> = [];
  public query<T>(
    query: string,
    params?: null | Array<SqlValue>
  ): Promise<SimpleSqlResponseInterface<T>> {
    this.queries.push({ query, params });
    return Promise.resolve({ rows: [] });
  }
}
