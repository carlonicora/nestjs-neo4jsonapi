import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { auth, driver, Driver, Session } from "neo4j-driver";
import { ClsService } from "nestjs-cls";
import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { baseConfig } from "../../../config/base.config";
import { JsonApiCursorInterface } from "../../jsonapi/interfaces/jsonapi.cursor.interface";
import { AppLoggingService } from "../../logging/services/logging.service";
import { EntityFactory } from "../factories/entity.factory";

export type QueryType<T> = {
  query: string;
  queryParams?: any;
  cursor?: JsonApiCursorInterface;
  serialiser?: DataModelInterface<T>;
  fetchAll?: boolean;
};

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private driver: Driver;
  private _database?: string;
  private activeConnections: number = 0;
  private readonly maxRetries: number = 3;
  private readonly retryDelay: number = 1000; // 1 second
  private readonly neo4jConfig: {
    uri: string;
    username: string;
    password: string;
    database: string;
    computePaginationTotal?: boolean;
  };
  // When false, readMany skips the extra COUNT query for {CURSOR} pagination. Apps that paginate
  // by cursor and never read meta.total set this to avoid expensive count-side projection traversals
  // (the count query has no LIMIT, so it would run every OPTIONAL MATCH across all rows). Default true.
  private readonly computePaginationTotal: boolean;

  constructor(
    private readonly entityFactory: EntityFactory,
    private readonly cls: ClsService,
    private readonly logger: AppLoggingService,
    configService: ConfigService<any>,
  ) {
    // Read the neo4j config from the injected (merged) app config so an app can
    // override the database/uri (e.g. a second service like corpus reading its own
    // database). Falls back to the package baseConfig (NEO4J_* env) when absent.
    this.neo4jConfig = configService.get("neo4j") ?? baseConfig.neo4j;
    if (!this.neo4jConfig?.uri) {
      throw new Error("Neo4j configuration is required. Ensure NEO4J_URI is set in environment.");
    }
    this.computePaginationTotal = this.neo4jConfig.computePaginationTotal !== false;

    this._database = this.neo4jConfig.database;
    this.driver = driver(this.neo4jConfig.uri, auth.basic(this.neo4jConfig.username, this.neo4jConfig.password), {
      maxConnectionPoolSize: 500,
      connectionAcquisitionTimeout: 20000,
      connectionTimeout: 20000,
      maxTransactionRetryTime: 15000,
      logging: {
        level: "info",
        logger: (level, message) => this.logger?.log(level, message),
      },
    });
  }

  initQuery<T>(params?: {
    cursor?: JsonApiCursorInterface;
    serialiser?: DataModelInterface<T>;
    fetchAll?: boolean;
  }): QueryType<any> {
    const queryParams: any = {};

    queryParams.companyId = this.cls.has("companyId") ? this.cls.get("companyId") : null;
    queryParams.currentUserId = this.cls.has("userId") ? this.cls.get("userId") : null;

    const query = `
        ${queryParams.companyId ? `MATCH (company:Company {id: $companyId})` : ``}
        ${
          queryParams.currentUserId
            ? queryParams.companyId
              ? `MATCH (currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company)`
              : `MATCH (currentUser:User {id: $currentUserId})`
            : ``
        }
    `;

    return {
      query: query,
      queryParams: queryParams,
      cursor: params?.cursor,
      serialiser: params?.serialiser,
      fetchAll: params?.fetchAll,
    };
  }

  getConfig(params: { indexName: string; nodeLabel: string; textNodeProperty: string }): any {
    return {
      url: this.neo4jConfig.uri,
      username: this.neo4jConfig.username,
      password: this.neo4jConfig.password,
      database: this.neo4jConfig.database,
      indexName: params.indexName,
      nodeLabel: params.nodeLabel,
      textNodeProperty: params.textNodeProperty,
      embeddingNodeProperty: "embedding",
      searchType: "vector",
      createdIndex: true,
    };
  }

  getDriver(): Driver {
    return this.driver;
  }

  async readOne<T>(params: QueryType<T>): Promise<T> {
    const result = await this.read(params.query, params.queryParams);
    if (result.records.length === 0) return null;

    const items = this.entityFactory.createGraphList({
      model: params.serialiser,
      records: result.records,
    });

    return items.length > 0 ? items[0] : null;
  }

  async readManyWithoutCount<T>(params: QueryType<T>): Promise<T[]> {
    params.query = params.query.replace(/^\s*$(?:\r\n?|\n)/gm, "");
    params.query = params.query.replace(/;\s*$/, "");

    if (params.query.includes("{CURSOR}")) {
      if (!params.fetchAll) {
        params.queryParams.cursor = params.cursor?.cursor;
        params.queryParams.take = params.cursor?.take ?? 26;

        if (params.cursor?.cursor)
          params.query = params.query.replace("{CURSOR}", `SKIP toInteger($cursor) LIMIT toInteger($take)`);
        else params.query = params.query.replace("{CURSOR}", `LIMIT toInteger($take)`);
      } else {
        params.query = params.query.replace("{CURSOR}", ``);
      }
    }

    try {
      const result = await this.read(params.query, params.queryParams);
      return this.entityFactory.createGraphList({
        model: params.serialiser,
        records: result.records,
      });
    } catch (error) {
      this.logger.error(params.query, params.queryParams);
      this.logger.error(error);
      throw error;
    }
  }

  async readMany<T>(params: QueryType<T>): Promise<T[]> {
    params.query = params.query.replace(/^\s*$(?:\r\n?|\n)/gm, "");
    params.query = params.query.replace(/;\s*$/, "");

    // Clear any previous query total (guard: no CLS context during startup/cron reads)
    if (this.cls.isActive()) this.cls.set("queryTotal", undefined);

    if (params.query.includes("{CURSOR}")) {
      if (!params.fetchAll) {
        params.queryParams.cursor = params.cursor?.cursor;
        params.queryParams.take = params.cursor?.take ?? 26;

        // Build count query if enabled and we have a serialiser with nodeName
        const countQuery =
          this.computePaginationTotal && params.serialiser?.nodeName
            ? this.buildCountQuery(params.query, params.serialiser.nodeName)
            : null;

        // Replace cursor placeholder for data query
        let dataQuery: string;
        if (params.cursor?.cursor)
          dataQuery = params.query.replace("{CURSOR}", `SKIP toInteger($cursor) LIMIT toInteger($take)`);
        else dataQuery = params.query.replace("{CURSOR}", `LIMIT toInteger($take)`);

        try {
          // Execute data query and count query in parallel
          if (countQuery) {
            const [dataResult, countResult] = await Promise.all([
              this.read(dataQuery, params.queryParams),
              this.read(countQuery, params.queryParams),
            ]);

            // Store total in CLS for JsonApiService to pick up
            if (countResult.records.length > 0) {
              const count = countResult.records[0].get("total");
              const total = count?.toNumber?.() ?? count ?? 0;
              if (this.cls.isActive()) this.cls.set("queryTotal", total);
            }

            return this.entityFactory.createGraphList({
              model: params.serialiser,
              records: dataResult.records,
            });
          } else {
            // Fallback: no count query, just run data query
            const result = await this.read(dataQuery, params.queryParams);
            return this.entityFactory.createGraphList({
              model: params.serialiser,
              records: result.records,
            });
          }
        } catch (error) {
          this.logger.error(dataQuery, params.queryParams);
          this.logger.error(error);
          throw error;
        }
      } else {
        params.query = params.query.replace("{CURSOR}", ``);
      }
    }

    try {
      const result = await this.read(params.query, params.queryParams);
      return this.entityFactory.createGraphList({
        model: params.serialiser,
        records: result.records,
      });
    } catch (error) {
      this.logger.error(params.query, params.queryParams);
      this.logger.error(error);
      throw error;
    }
  }

  /**
   * Build a count query from a data query by:
   * 1. Taking everything before {CURSOR}
   * 2. Removing ORDER BY clause
   * 3. Adding RETURN count(DISTINCT nodeName) AS total
   */
  private buildCountQuery(query: string, nodeName: string): string {
    const cursorIndex = query.indexOf("{CURSOR}");
    if (cursorIndex === -1) return null;

    // Take query up to {CURSOR}
    let countQuery = query.substring(0, cursorIndex);

    // Remove ORDER BY clause (case-insensitive, handles multi-line)
    countQuery = countQuery.replace(/ORDER\s+BY\s+[^{]+$/is, "");

    // Add count return
    countQuery += `\nRETURN count(DISTINCT ${nodeName}) AS total`;

    return countQuery;
  }

  async writeOne<T>(params: QueryType<T>): Promise<T | null> {
    const result = await this.write(params.query, params.queryParams);

    if (!params.serialiser || result.records.length === 0) return null;

    const items = this.entityFactory.createGraphList({
      model: params.serialiser,
      records: result.records,
    });

    return items.length > 0 ? items[0] : null;
  }

  async writeAndReturnMany<T>(params: QueryType<T>): Promise<T[] | null> {
    const result = await this.write(params.query, params.queryParams);

    if (!params.serialiser || result.records.length === 0) return null;

    return this.entityFactory.createGraphList({
      model: params.serialiser,
      records: result.records,
    });
  }

  async readCount(query: string, params?: any): Promise<number> {
    const result = await this.read(query, params);
    if (result.records.length === 0) return 0;

    const count = result.records[0].get("total");
    return count?.toNumber?.() ?? count ?? 0;
  }

  async read(query: string, params?: any): Promise<any> {
    let session;
    if (this._database) session = this.driver.session({ database: this._database });
    else session = this.driver.session();

    try {
      return await session.executeRead(async (tx) => {
        const result = await tx.run(query, params ?? {});
        return result;
      });
    } catch (error) {
      this.logger.error(query, params);
      this.logger.error(error);
      if (error instanceof Error) {
        throw new Error(`Neo4j Read Error: ${error.message}`);
      } else {
        throw new Error("Neo4j Read Error: An unknown error occurred while reading the data");
      }
    } finally {
      await session.close();
    }
  }

  async validateExistingNodes(params: { nodes: { id: string; label: string }[] }): Promise<void> {
    if (params.nodes.length === 0) return;

    const matchClauses = params.nodes
      .map((node, index) => `MATCH (n${index}:${node.label} {id: $id${index}})`)
      .join("\n");
    const countClauses = params.nodes.map((_, index) => `n${index}`).join(", ");
    const countParams = params.nodes.reduce((acc, node, index) => {
      acc[`id${index}`] = node.id;
      return acc;
    }, {});

    const validationResult = await this.read(
      `
        ${matchClauses}
        RETURN ${countClauses}
      `,
      countParams,
    );

    if (validationResult.records.length === 0) {
      throw new BadRequestException("One or more related nodes do not exist.");
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay * attempt));
        }
      }
    }

    throw lastError;
  }

  private async write(query: string, params?: any): Promise<any> {
    let session: Session | null = null;

    try {
      this.activeConnections++;
      session = this._database ? this.driver.session({ database: this._database }) : this.driver.session();

      return await this.withRetry(async () => {
        return await session!.executeWrite(async (tx) => {
          return await tx.run(query, params ?? {});
        });
      });
    } finally {
      if (session) {
        try {
          await session.close();
        } finally {
          this.activeConnections--;
        }
      }
    }
  }

  // Add a method to monitor active connections
  public getActiveConnections(): number {
    return this.activeConnections;
  }

  // Add cleanup method for graceful shutdown
  public async cleanup(): Promise<void> {
    try {
      await this.driver.close();
    } catch (error) {
      this.logger.error("Error during Neo4j driver cleanup:", error);
    }
  }

  async executeInTransaction(queries: { query: string; params?: any }[]): Promise<any[]> {
    const session = this.driver.session({
      database: this.neo4jConfig.database,
    });

    const tx = session.beginTransaction();
    const results = [];

    try {
      for (const { query, params } of queries) {
        const result = await tx.run(query, params);
        results.push(result);
      }

      await tx.commit();
      return results;
    } catch (error) {
      await tx.rollback();
      throw new Error(`Transaction failed: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  async onModuleInit() {}

  async onModuleDestroy() {
    await this.driver.close();
  }
}
