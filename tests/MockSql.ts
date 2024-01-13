import {
  SimpleSqlDbInterface,
  SimpleSqlResponseInterface,
  SqlValue,
} from "@wymp/ts-simple-interfaces";

export class MockSql implements SimpleSqlDbInterface {
  protected results: Array<Array<any>> = [];

  public readonly queries: Array<{
    query: string;
    params: null | undefined | Array<SqlValue>;
  }> = [];
  public query<T>(
    query: string,
    params?: null | Array<SqlValue>
  ): Promise<SimpleSqlResponseInterface<T>> {
    this.queries.push({ query, params });
    return Promise.resolve({ rows: this.results.shift() || [] });
  }
  public transaction<T>(
    queries: (cnx: SimpleSqlDbInterface) => Promise<T>,
    txName?: string | null | undefined
  ): Promise<T> {
    return queries(this);
  }
  public setNextResult(rows: Array<any>) {
    this.results.push(rows);
  }
}
