import {
  type SimpleSqlDbInterface,
  type SimpleSqlResponseInterface,
  type SqlValue,
} from "@wymp/ts-simple-interfaces";

export class MockSql implements SimpleSqlDbInterface {
  protected results: Array<Array<any>> = [];

  public readonly queries: Array<{
    query: string;
    params: null | undefined | Array<SqlValue>;
  }> = [];

  public async query<T>(
    query: string,
    params?: null | Array<SqlValue>
  ): Promise<SimpleSqlResponseInterface<T>> {
    this.queries.push({ query, params });
    return await Promise.resolve({ rows: this.results.shift() || [] });
  }

  public async transaction<T>(
    queries: (cnx: SimpleSqlDbInterface) => Promise<T>,
    txName?: string | null | undefined
  ): Promise<T> {
    return await queries(this);
  }

  public setNextResult(rows: Array<any>): void {
    this.results.push(rows);
  }
}
